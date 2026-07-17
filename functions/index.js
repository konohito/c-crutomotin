'use strict'
/* Cruto motion — 記録用紙 OCR バックエンド
   HTTPS 関数 recognizeSheet: 画像(base64) または Cloud Storage の gs:// URI を受け取り、
   Document AI で認識 → 記録用紙スキーマにマッピングして返す。
   フロントの src/lib/ocr.js から呼ばれる。 */
const { onRequest } = require('firebase-functions/v2/https')
const { setGlobalOptions } = require('firebase-functions/v2')
const cfg = require('./src/config')
const { processDocument } = require('./src/documentai')
const { mapDocumentToSheet } = require('./src/mapping')

// 東京リージョン。関数の実行リージョンと Document AI のロケーション(cfg.location)は別物。
setGlobalOptions({ region: 'asia-northeast1', memory: '512MiB', timeoutSeconds: 60, maxInstances: 10 })

function setCors(res) {
  res.set('Access-Control-Allow-Origin', cfg.allowOrigin)
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
  res.set('Access-Control-Max-Age', '3600')
}

exports.recognizeSheet = onRequest(async (req, res) => {
  setCors(res)
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST のみ対応しています' }); return }
  if (cfg.apiKey && req.get('X-Api-Key') !== cfg.apiKey) {
    res.status(401).json({ ok: false, error: '認証に失敗しました' }); return
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
