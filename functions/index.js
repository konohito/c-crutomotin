'use strict'
/* Cruto motion — 記録用紙 OCR バックエンド
   HTTPS 関数 recognizeSheet: 画像(base64) または Cloud Storage の gs:// URI を受け取り、
   Document AI で認識 → 記録用紙スキーマにマッピングして返す。
   フロントの src/lib/ocr.js から呼ばれる。 */
const { onRequest } = require('firebase-functions/v2/https')
const { onObjectFinalized } = require('firebase-functions/v2/storage')
const { setGlobalOptions } = require('firebase-functions/v2')
const admin = require('firebase-admin')
const cfg = require('./src/config')
const { processDocument } = require('./src/documentai')
const { mapDocumentToSheet } = require('./src/mapping')
const { parseStoragePath, buildRecognitionDoc } = require('./src/recognition')

admin.initializeApp()

// 東京リージョン。関数の実行リージョンと Document AI のロケーション(cfg.location)は別物。
setGlobalOptions({ region: 'asia-northeast1', memory: '512MiB', timeoutSeconds: 60, maxInstances: 10 })

function setCors(res) {
  res.set('Access-Control-Allow-Origin', cfg.allowOrigin)
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization')
  res.set('Access-Control-Max-Age', '3600')
}

exports.recognizeSheet = onRequest(async (req, res) => {
  setCors(res)
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST のみ対応しています' }); return }
  if (cfg.apiKey && req.get('X-Api-Key') !== cfg.apiKey) {
    res.status(401).json({ ok: false, error: '認証に失敗しました' }); return
  }
  // 職員ログイン必須(OCR_REQUIRE_AUTH=1): フロントが添付する Firebase Auth の ID トークンを検証する
  if (cfg.requireAuth) {
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '')
    if (!m) { res.status(401).json({ ok: false, error: '職員ログインが必要です' }); return }
    try { await admin.auth().verifyIdToken(m[1]) }
    catch { res.status(401).json({ ok: false, error: 'ログインの有効期限が切れています。再ログインしてください' }); return }
  }
  try {
    const { imageBase64, gcsUri, mimeType } = req.body || {}
    if (!imageBase64 && !gcsUri) {
      res.status(400).json({ ok: false, error: 'imageBase64 または gcsUri が必要です' }); return
    }
    let content
    if (imageBase64) {
      const b64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '')
      content = Buffer.from(b64, 'base64')
      if (content.length === 0) { res.status(400).json({ ok: false, error: '画像を復元できませんでした' }); return }
      if (content.length > cfg.maxImageBytes) {
        res.status(413).json({ ok: false, error: `画像サイズが上限(${Math.round(cfg.maxImageBytes / 1048576)}MB)を超えています` }); return
      }
    }
    const document = await processDocument({ content, gcsUri, mimeType })
    const sheet = mapDocumentToSheet(document)
    res.json({ ok: true, sheet })
  } catch (err) {
    console.error('recognizeSheet error:', err)
    res.status(500).json({ ok: false, error: err.message || '内部エラーが発生しました' })
  }
})

/* フェーズ2: 非同期 OCR 取り込みパイプライン。
   モバイルが記録用紙画像を gs://<bucket>/sheets/{batchId}/{no}-*.jpg に保存すると発火し、
   Document AI で認識した結果を Firestore の
   batches/{batchId}/recognitions/{recognitionId} に保存する(＝読み取りキュー)。
   台帳照合・本登録はフロント側(職員が確認)で行う。 */
exports.onSheetImageUpload = onObjectFinalized({ memory: '512MiB', timeoutSeconds: 120 }, async (event) => {
  const obj = event.data
  const name = obj.name || ''
  const parsed = parseStoragePath(name)
  if (!parsed) return // sheets/{batchId}/... 以外は無視(サムネイル等)
  const bucket = obj.bucket
  const gcsUri = `gs://${bucket}/${name}`
  const db = admin.firestore()
  const ref = db.collection('batches').doc(parsed.batchId).collection('recognitions').doc()
  try {
    const document = await processDocument({ gcsUri, mimeType: obj.contentType || 'image/jpeg' })
    const rec = buildRecognitionDoc(document, {
      no: parsed.no, storagePath: name, threshold: cfg.reviewThreshold,
    })
    await ref.set({ ...rec, batchId: parsed.batchId, bucket, recognizedAt: admin.firestore.FieldValue.serverTimestamp() })
    // バッチのメタ(件数)を更新
    await db.collection('batches').doc(parsed.batchId).set(
      { updatedAt: admin.firestore.FieldValue.serverTimestamp(), sheetCount: admin.firestore.FieldValue.increment(1) },
      { merge: true },
    )
  } catch (err) {
    console.error('onSheetImageUpload error:', name, err)
    await ref.set({
      no: parsed.no, storagePath: name, batchId: parsed.batchId, status: 'error',
      error: err.message || 'OCR に失敗しました', recognizedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
})
