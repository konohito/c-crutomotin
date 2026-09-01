'use strict'
/* Cruto motion — 記録用紙 OCR バックエンド
   HTTPS 関数 recognizeSheet: 画像(base64) または Cloud Storage の gs:// URI を受け取り、
   Document AI で認識 → 記録用紙スキーマにマッピングして返す。
   フロントの src/lib/ocr.js から呼ばれる。 */
const { onRequest } = require('firebase-functions/v2/https')
const { onObjectFinalized } = require('firebase-functions/v2/storage')
const { setGlobalOptions } = require('firebase-functions/v2')
const admin = require('firebase-admin')
// FieldValue はモジュラー import で取得する(admin.firestore.FieldValue はランタイム/バージョンにより
// 未定義になることがあるため。firebase-functions v2 の推奨形)。
const { FieldValue } = require('firebase-admin/firestore')
const cfg = require('./src/config')
const { processDocument } = require('./src/documentai')
const { mapDocumentToSheet } = require('./src/mapping')
const { parseStoragePath, buildRecognitionDoc } = require('./src/recognition')
const { readKcl } = require('./src/kclread')
const { readSheetVision, mergeKcl, kclFromVision } = require('./src/visionread')

admin.initializeApp()

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

/* フェーズ2: 非同期 OCR 取り込みパイプライン。
   モバイルが記録用紙画像を gs://<bucket>/sheets/{batchId}/{no}-*.jpg に保存すると発火し、
   Document AI で認識した結果を Firestore の
   batches/{batchId}/recognitions/{recognitionId} に保存する(＝読み取りキュー)。
   台帳照合・本登録はフロント側(職員が確認)で行う。 */
// 写真 1 枚あたり、画像のダウンロード + Document AI + 画素解析(RGBA 展開)を行うため
// メモリを厚めに取る。不足するとインスタンスが落ち、recognition が作られないまま
// 用紙が消えてしまう(取りこぼし)。
exports.onSheetImageUpload = onObjectFinalized({ memory: '1GiB', timeoutSeconds: 300 }, async (event) => {
  const obj = event.data
  const name = obj.name || ''
  const parsed = parseStoragePath(name)
  if (!parsed) return // sheets/{batchId}/... 以外は無視(サムネイル等)
  const bucket = obj.bucket
  const db = admin.firestore()
  const ref = db.collection('batches').doc(parsed.batchId).collection('recognitions').doc()
  // 成否に関わらずバッチのメタを更新し、取り込み画面のバッチ一覧に必ず現れるようにする
  const touchBatch = () => db.collection('batches').doc(parsed.batchId).set(
    { updatedAt: FieldValue.serverTimestamp(), sheetCount: FieldValue.increment(1) },
    { merge: true },
  )
  try {
    // 画像は関数がバケットから読み込んで bytes で渡す。
    // (gcsUri 渡しだと Document AI 側のサービスにバケット読み取り権限が必要になり、
    //  secure-by-default の組織では既定で拒否されて失敗するため)
    const [content] = await admin.storage().bucket(bucket).file(name).download()
    const document = await processDocument({ content, mimeType: obj.contentType || 'image/jpeg' })
    const rec = buildRecognitionDoc(document, {
      no: parsed.no, storagePath: name, threshold: cfg.reviewThreshold,
    })
    // 問診票(様式 R7-03/R7-03W)はマークシート読み取りを付与し、必ず職員確認を通す
    try {
      const kcl = readKcl(document, content, obj.contentType || 'image/jpeg')
      if (kcl.isKcl) {
        // debug は原因調査用(位置合わせの補正量・設問ごとの濃度)。画面には出さない
        rec.kcl = { side: kcl.side || null, answers: kcl.answers || {}, readable: !!kcl.readable, reason: kcl.reason || null, via: kcl.via || null, debug: kcl.debug || null }
        rec.needsReview = true
        // シール/手書きの ID にはラベル語が無いことがある → 単独の 5 桁数字を ID として拾う
        if (!rec.ocrId) {
          const m5 = String(document.text || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).match(/(?:^|[^0-9])(\d{5})(?![0-9])/)
        if (m5) rec.ocrId = m5[1]
        }
      }
    } catch (err2) { console.error('kclread error:', name, err2) }
    /* ビジョン AI(Gemini)でも写真を読み、結果を統合する。
       - 問診票: 幾何ロジックの読みと統合(読めなかった設問の補完 + 正反対の主張は要確認へ)
       - ID・氏名: OCR で取れなかったときの補完(照合で名前が出ないケースの救済)
       - 文字認識ごと失敗した問診票の写真: ビジョン AI 単独で読む
       呼び出しに失敗しても従来の結果のまま進む(ログにだけ残す)。 */
    try {
      const vis = await readSheetVision(content, obj.contentType || 'image/jpeg')
      if (vis) {
        if (!rec.ocrId && vis.id) rec.ocrId = vis.id
        if (!rec.ocrName && vis.name) rec.ocrName = vis.name
        if (!rec.ocrKana && vis.kana) rec.ocrKana = vis.kana
        if (rec.kcl && vis.type === 'kcl') {
          rec.kcl = mergeKcl(rec.kcl, vis)
        } else if (!rec.kcl && vis.type === 'kcl') {
          const kv = kclFromVision(vis)
          if (kv) {
            rec.kcl = kv
            rec.needsReview = true
          }
        }
        if (rec.kcl && rec.kcl.debug) rec.kcl.debug.visionModel = vis.model || null
      }
    } catch (err3) {
      console.error('visionread error:', name, err3.message || err3)
      // 失敗理由を読み取り診断に表示し、現地で原因(権限・API 無効など)を切り分けられるようにする
      if (rec.kcl) {
        rec.kcl.debug = { ...(rec.kcl.debug || {}), visionError: String(err3.message || err3).slice(0, 300) }
      }
    }
    await ref.set({ ...rec, batchId: parsed.batchId, bucket, recognizedAt: FieldValue.serverTimestamp() })
    // 飛び込み用紙(様式 R7-02W)はトップレベルの walkins にも複製し、
    // 「飛び込み読み込み」画面が索引なしの単純クエリで購読できるようにする
    if (rec.walkIn) {
      await db.collection('walkins').doc(ref.id).set({
        ...rec, batchId: parsed.batchId, bucket,
        walkinStatus: 'pending', // pending(受付待ち) → committed(仮登録・取り込み済) → registered(台帳登録済)
        recognizedAt: FieldValue.serverTimestamp(),
      })
    }
    await touchBatch()
  } catch (err) {
    console.error('onSheetImageUpload error:', name, err)
    await ref.set({
      no: parsed.no, storagePath: name, batchId: parsed.batchId, status: 'error',
      error: err.message || 'OCR に失敗しました', recognizedAt: FieldValue.serverTimestamp(),
    })
    await touchBatch().catch(() => {})
  }
})
