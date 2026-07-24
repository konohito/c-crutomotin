'use strict'
/* Document AI クライアントのラッパー。記録用紙の画像 or Cloud Storage 上のファイルを
   1 回 processDocument して document を返す。認証は Cloud Functions の
   サービスアカウント(ADC)を利用するため、コード内に鍵は持たない。 */
const cfg = require('./config')
const { mockDocument } = require('./mockdoc')

let client
function getClient() {
  if (!client) {
    // @google-cloud/documentai は重いため、初回呼び出し時に遅延ロードする
    // (デプロイ時のコード解析タイムアウトとコールドスタートの短縮)
    const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1
    // ロケーション別エンドポイント(例: us-documentai.googleapis.com)
    client = new DocumentProcessorServiceClient({ apiEndpoint: `${cfg.location}-documentai.googleapis.com` })
  }
  return client
}

// モック認識を使うか。実運用(FUNCTIONS_EMULATOR 未設定)では processorId が無ければエラーにするため false。
// ・DOCAI_MOCK=1 を明示した場合
// ・ローカルエミュレータ(FUNCTIONS_EMULATOR=true)で実プロセッサ未設定の場合
// のいずれかで、実 Document AI を呼ばず合成レスポンスを返す。
function useMock() {
  if (process.env.DOCAI_MOCK === '1') return true
  return process.env.FUNCTIONS_EMULATOR === 'true' && !cfg.processorId
}

// { content(Buffer) | gcsUri(string), mimeType } → document
async function processDocument({ content, gcsUri, mimeType }) {
  if (useMock()) {
    // 用紙ごとに決定論的な擬似認識結果を返す(GCP 資格情報不要)
    return mockDocument(gcsUri || (content && content.length) || 'mock')
  }
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
