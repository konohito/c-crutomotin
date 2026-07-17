'use strict'
/* Document AI クライアントのラッパー。記録用紙の画像 or Cloud Storage 上のファイルを
   1 回 processDocument して document を返す。認証は Cloud Functions の
   サービスアカウント(ADC)を利用するため、コード内に鍵は持たない。 */
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1
const cfg = require('./config')

let client
function getClient() {
  if (!client) {
    // ロケーション別エンドポイント(例: us-documentai.googleapis.com)
    client = new DocumentProcessorServiceClient({ apiEndpoint: `${cfg.location}-documentai.googleapis.com` })
  }
  return client
}

// { content(Buffer) | gcsUri(string), mimeType } → document
async function processDocument({ content, gcsUri, mimeType }) {
  if (!cfg.project || !cfg.processorId) {
    throw new Error('DOCAI_PROJECT_ID / DOCAI_PROCESSOR_ID が未設定です。functions/.env を確認してください。')
  }
  const c = getClient()
  const name = c.processorPath(cfg.project, cfg.location, cfg.processorId)
  const request = { name }
  if (gcsUri) request.gcsDocument = { gcsUri, mimeType: mimeType || 'image/jpeg' }
  else request.rawDocument = { content, mimeType: mimeType || 'image/jpeg' }
  const [result] = await c.processDocument(request)
  return result.document
}

module.exports = { processDocument }
