'use strict'
/* Storage トリガ経路のロジック。GCP 非依存の純粋関数として切り出し、単体テスト可能にする。
   Cloud Storage に上がった記録用紙画像 → Document AI → Firestore に保存する
   recognition ドキュメントを組み立てる。 */
const { mapDocumentToSheet } = require('./mapping')

// Storage オブジェクト名 → { batchId, filename, no }
// 期待パス: sheets/{batchId}/{filename}  (filename 先頭の数字を用紙番号 no とみなす)
function parseStoragePath(name) {
  const parts = String(name || '').split('/').filter(Boolean)
  const i = parts.indexOf('sheets')
  if (i < 0 || parts.length < i + 3) return null
  const batchId = parts[i + 1]
  const filename = parts.slice(i + 2).join('/')
  const m = filename.match(/(\d+)/)
  return { batchId, filename, no: m ? parseInt(m[1], 10) : null }
}

// document → Firestore recognition ドキュメント。信頼度しきい値未満の項目数も添える。
function buildRecognitionDoc(document, meta = {}) {
  const sheet = mapDocumentToSheet(document)
  const threshold = meta.threshold || 80
  const lowConf = Object.keys(sheet.fields).filter(cid => {
    const f = sheet.fields[cid]
    return f.conf > 0 && f.conf < threshold
  })
  return {
    no: meta.no != null ? meta.no : null,
    storagePath: meta.storagePath || '',
    status: 'recognized',
    ocrName: sheet.ocrName,
    ocrKana: sheet.ocrKana,
    ocrId: sheet.ocrId,
    nameConf: sheet.nameConf,
    fields: sheet.fields,
    lowConfFields: lowConf,          // フロントの要確認振り分けの補助
    needsReview: lowConf.length > 0 || sheet.nameConf < threshold,
  }
}

module.exports = { parseStoragePath, buildRecognitionDoc }
