'use strict'
/* 本番 OCR パイプラインの診断（GitHub Actions から実行）。
   公開リポジトリの Actions ログに出るため、読み取り値・氏名などの個人情報は一切出力しない。
   出力するのは: バッチID/件数/時刻、recognitions の status・エラー文・時刻、Storage のパス一覧のみ。 */
const admin = require('firebase-admin')

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'cruto-motion' })
const db = admin.firestore()

const ts = (t) => (t && t.toDate ? t.toDate().toISOString() : String(t))

async function main() {
  console.log('== batches (updatedAt desc, 20件) ==')
  try {
    const bs = await db.collection('batches').orderBy('updatedAt', 'desc').limit(20).get()
    console.log('batches:', bs.size)
    bs.forEach((d) => {
      const x = d.data()
      console.log(`  ${d.id} sheetCount=${x.sheetCount} updatedAt=${ts(x.updatedAt)}`)
    })
  } catch (e) {
    console.log('BATCHES QUERY FAILED:', e.message)
  }

  console.log('== recognitions (collectionGroup 全件) ==')
  try {
    const rs = await db.collectionGroup('recognitions').get()
    console.log('total:', rs.size)
    const byStatus = {}
    rs.forEach((d) => {
      const x = d.data()
      byStatus[x.status] = (byStatus[x.status] || 0) + 1
    })
    console.log('byStatus:', JSON.stringify(byStatus))
    rs.forEach((d) => {
      const x = d.data()
      console.log(`  ${x.batchId}/${d.id} no=${x.no} status=${x.status} err=${String(x.error || '').slice(0, 200)} at=${ts(x.recognizedAt)}`)
    })
  } catch (e) {
    console.log('RECOGNITIONS QUERY FAILED:', e.message)
  }

  console.log('== バッジと同じクエリ (collectionGroup + status in [recognized,error]) ==')
  try {
    const q = await db.collectionGroup('recognitions').where('status', 'in', ['recognized', 'error']).get()
    console.log('pending count:', q.size)
  } catch (e) {
    console.log('BADGE QUERY FAILED:', e.message)
  }

  console.log('== Storage sheets/ 配下 (50件) ==')
  try {
    const [files] = await admin.storage().bucket('cruto-motion.firebasestorage.app').getFiles({ prefix: 'sheets/', maxResults: 50 })
    console.log('files:', files.length)
    files.forEach((f) => console.log(`  ${f.name} created=${f.metadata && f.metadata.timeCreated}`))
  } catch (e) {
    console.log('STORAGE LIST FAILED:', e.message)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('DIAG FAILED:', e); process.exit(1) })
