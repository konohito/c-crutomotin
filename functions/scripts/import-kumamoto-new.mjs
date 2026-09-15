#!/usr/bin/env node
/* 台帳にあるのにアプリへ入っていない測定だけを、新しく作る。

   なぜ要るか:
     熊本市の台帳は「評価日_終了時」が空欄のまま出力された行があり、
     終了時の測定値は書かれているのに日付が無いせいで取り込みから丸ごと漏れていた。
     現場に終了日を確認できたので、その 3 件だけを足す。

   安全のきまり:
     - すでにある測定文書には一切触らない（存在したら飛ばす。上書きしない）
     - つまりアプリ(OCR・手入力)で入れた測定は絶対に書き換わらない
     - 既定は下見のみ。--write を付けたときだけ書き込む

   使い方:
     node scripts/import-kumamoto-new.mjs normalized-kumamoto.json
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/import-kumamoto-new.mjs normalized-kumamoto.json --write */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const file = process.argv[2] || 'normalized-kumamoto.json'
const WRITE = process.argv.includes('--write')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
const data = JSON.parse(readFileSync(file, 'utf8'))

const MEAS_FIELDS = ['walk5', 'walk5max', 'balR', 'balL', 'gripR', 'gripL', 'tug', 'height', 'weight', 'bmi']
const META = ['examiner', 'trainingType', 'selfTraining', 'assistive', 'assistiveOther', 'comment', 'goal', 'freeNote']

admin.initializeApp({ projectId })
const db = admin.firestore()
const compact = (d) => {
  const m = String(d || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''
}

async function main() {
  console.log(`[new] project=${projectId} file=${file} ${WRITE ? '★書き込みます' : '下見のみ(書き込みません)'}`)
  const plan = []
  for (const u of data) {
    for (const m of Object.values(u.meas || {})) {
      const c = compact(m.date)
      if (!c) continue
      plan.push({ docId: `${u.id}_${c}`, u, m })
    }
  }
  let exists = 0
  const create = []
  for (const p of plan) {
    const snap = await db.collection('measurements').doc(p.docId).get()
    if (snap.exists) { exists++; continue }
    create.push(p)
  }
  console.log(`[new] 台帳の測定 ${plan.length} 件 / すでにある ${exists} 件 / 新しく作る ${create.length} 件`)
  for (const p of create) {
    console.log(`   作成: ${p.docId}  ${p.u.name}  ${p.m.date}  ${p.m.source}  program=${p.m.program || 'city'}`)
    console.log(`         値: ${MEAS_FIELDS.map(k => `${k}=${p.m[k] ?? '—'}`).join(' ')}`)
  }
  if (!WRITE) { console.log('[new] 下見のみ。実行するには --write を付けてください'); return }
  if (!create.length) { console.log('[new] 作るものはありません'); return }

  for (const p of create) {
    const values = {}
    for (const k of MEAS_FIELDS) values[k] = (p.m[k] === undefined ? null : p.m[k])
    const doc = {
      userId: String(p.u.id), year: Number(p.m.year), date: p.m.date,
      values, source: p.m.source || '', program: p.m.program || 'city', review: !!p.m.review,
    }
    for (const k of META) if (p.m[k]) doc[k] = p.m[k]
    // create() は「すでにあれば失敗する」。競合しても既存を壊さない
    await db.collection('measurements').doc(p.docId).create(doc)
    // 電子手帳(本人ログイン)は文書 ID 指定でしか読めないため索引も足す
    await db.collection('users').doc(String(p.u.id))
      .set({ measKeys: admin.firestore.FieldValue.arrayUnion(p.docId) }, { merge: true })
  }
  console.log(`[new] 完了: ${create.length} 件を作成しました`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
