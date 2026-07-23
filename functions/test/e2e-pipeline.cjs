'use strict'
/* 非同期 OCR 取り込みパイプラインの通し(E2E)テスト。
   `firebase emulators:exec` 配下で実行し、Firestore / Storage / Functions エミュレータを使う。
   実 GCP 資格情報は不要(Document AI はエミュレータ上でモックに切り替わる)。

   検証内容:
     Storage に記録用紙画像を保存
       → onSheetImageUpload トリガ発火
       → Document AI(モック)で認識
       → Firestore batches/{batchId}/recognitions に読み取り結果が保存される
     までを実際に動かして確認する。 */
const admin = require('firebase-admin')

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'demo-cruto'
// エミュレータの既定バケットは <project>.appspot.com。onObjectFinalized(bucket 未指定)は
// この既定バケットを監視するため、アップロード先も一致させる。
const BUCKET = process.env.STORAGE_BUCKET || `${PROJECT}.appspot.com`

admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET })
const db = admin.firestore()
const bucket = admin.storage().bucket()

const BATCH = 'e2e-' + Date.now()
const SHEETS = 3 // 3 枚アップロードして 3 件の読み取りができることを見る
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  console.log(`[E2E] project=${PROJECT} bucket=${BUCKET} batch=${BATCH}`)

  // 1) 記録用紙画像(ダミー)を Storage に保存 → トリガ発火
  for (let no = 1; no <= SHEETS; no++) {
    const path = `sheets/${BATCH}/${no}-sheet.jpg`
    await bucket.file(path).save(Buffer.from(`dummy-jpeg-${no}`), { contentType: 'image/jpeg' })
    console.log(`[E2E] uploaded ${path}`)
  }

  // 2) Firestore の読み取りキューに SHEETS 件たまるまで待つ(最大 ~45 秒)
  const col = db.collection('batches').doc(BATCH).collection('recognitions')
  let docs = []
  for (let i = 0; i < 90; i++) {
    const snap = await col.get()
    docs = snap.docs.map(d => d.data())
    if (docs.length >= SHEETS) break
    await sleep(500)
  }

  // 3) 検証
  const errors = []
  if (docs.length < SHEETS) errors.push(`recognitions が ${docs.length}/${SHEETS} 件しかありません`)
  const FIELDS = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL']
  docs.forEach((d, i) => {
    if (d.status !== 'recognized') errors.push(`#${i + 1} status=${d.status}(recognized 以外)`)
    if (!d.fields) { errors.push(`#${i + 1} fields なし`); return }
    const missing = FIELDS.filter(f => !d.fields[f] || d.fields[f].value == null)
    if (missing.length) errors.push(`#${i + 1} 値の欠落: ${missing.join(',')}`)
    if (!d.ocrName) errors.push(`#${i + 1} ocrName なし`)
  })

  // バッチメタ(件数)も更新されているか
  const meta = (await db.collection('batches').doc(BATCH).get()).data() || {}
  if ((meta.sheetCount || 0) < SHEETS) errors.push(`batch.sheetCount=${meta.sheetCount}(${SHEETS} 未満)`)

  console.log('\n[E2E] 読み取り結果:')
  docs.sort((a, b) => (a.no || 0) - (b.no || 0)).forEach(d => {
    const g = d.fields || {}
    console.log(`  no.${d.no} ${d.ocrName}(${d.ocrKana}) ID=${d.ocrId} ` +
      `身長${g.height && g.height.value} 体重${g.weight && g.weight.value} ` +
      `握力R${g.gripR && g.gripR.value} TUG${g.tug && g.tug.value} ` +
      `要確認=${d.needsReview}(低信頼度: ${(d.lowConfFields || []).join(',') || 'なし'})`)
  })

  if (errors.length) {
    console.error('\n[E2E] FAILED:\n - ' + errors.join('\n - '))
    process.exit(1)
  }
  console.log(`\n[E2E] PASSED — ${docs.length} 枚すべて Storage→トリガ→OCR→Firestore を通過`)
  process.exit(0)
}

main().catch(err => { console.error('[E2E] error:', err); process.exit(1) })
