#!/usr/bin/env node
/* 実在しない利用者（読み取りが用紙の項目名を氏名として拾って作られたもの等）を片付ける。

   削除はしない。利用者に archived を立てて台帳から外し、ぶら下がっている測定は
   voided を立てて集計・提出から外すだけ。控えを JSON に書き出すので、後から戻せる。

   安全のきまり:
     - 測定値が 1 つでも入っている測定があるときは、中断して何もしない。
       誰かの測定かもしれないものを、中身を確かめずに外さないため。
       （それでも外す場合は --force を付ける。理由を記録に残す）
     - 既定は下見のみ。--write を付けたときだけ書き込む

   使い方:
     node scripts/archive-user.mjs 13902 "理由"
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/archive-user.mjs 13902 "理由" --write */
import { writeFileSync } from 'node:fs'
import admin from 'firebase-admin'

const userId = process.argv[2]
const reason = process.argv[3] || ''
const WRITE = process.argv.includes('--write')
const FORCE = process.argv.includes('--force')
if (!userId) { console.error('使い方: node scripts/archive-user.mjs <利用者ID> "理由" [--write]'); process.exit(2) }
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
admin.initializeApp({ projectId })
const db = admin.firestore()

const hasValues = (m) => m.values && Object.values(m.values).some(v => v !== null && v !== undefined)

async function main() {
  console.log(`[arch] project=${projectId} 利用者=${userId} ${WRITE ? '★書き込みます' : '下見のみ(書き込みません)'}`)
  const uref = db.collection('users').doc(userId)
  const usnap = await uref.get()
  if (!usnap.exists) { console.error('[arch] 利用者が見つかりません'); process.exit(1) }
  const u = usnap.data()
  console.log(`[arch] 氏名="${u.name}" ${u.muniName}/${u.ward || ''} archived=${!!u.archived}`)

  const msnap = await db.collection('measurements').where('userId', '==', userId).get()
  const meas = msnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`[arch] ぶら下がっている測定: ${meas.length} 件`)
  for (const m of meas) {
    console.log(`   ${m.id}  評価日=${m.date ?? '(項目なし)'}  測定値=${hasValues(m) ? '★あり' : 'なし'}  問診=${Object.keys(m.kclAnswers || {}).length}問  すでに無効=${!!m.voided}`)
  }
  const withVal = meas.filter(m => hasValues(m) && !m.voided)
  if (withVal.length && !FORCE) {
    console.error(`[arch] ★中断: 測定値の入った測定が ${withVal.length} 件あります（${withVal.map(m => m.id).join(', ')}）。`)
    console.error('[arch] どなたの測定かを確かめてから進めてください。それでも外す場合は --force を付けてください。')
    process.exit(1)
  }
  if (!WRITE) { console.log('[arch] 下見のみ。実行するには --write を付けてください'); return }

  const backup = `/tmp/archive-user-${userId}-${Date.now()}.json`
  writeFileSync(backup, JSON.stringify({ userId, user: u, measurements: meas, reason, at: new Date().toISOString() }, null, 1))
  console.log(`[arch] 控えを書き出しました: ${backup}`)

  const at = new Date().toISOString()
  for (const m of meas) {
    if (m.voided) continue
    await db.collection('measurements').doc(m.id).set({ voided: true, archivedReason: reason, archivedAt: at }, { merge: true })
    console.log(`   済 測定 ${m.id} を無効にしました（削除はしていません）`)
  }
  await uref.set({ archived: true, archivedAt: at, archivedReason: reason }, { merge: true })
  console.log(`[arch] 済 利用者 ${userId} を台帳から外しました（削除はしていません）`)
  console.log(`[arch] 戻すには 控え ${backup} を見て、archived / voided を false（または項目ごと削除）にしてください`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
