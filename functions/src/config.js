'use strict'
/* 環境変数から設定を読み込む。Cloud Functions では GCLOUD_PROJECT が自動設定される。
   ローカルエミュレータでは functions/.env を使う(.env.example を参照)。 */
module.exports = {
  project: process.env.DOCAI_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '',
  location: process.env.DOCAI_LOCATION || 'us', // Document AI のロケーション: 'us' / 'eu' など
  processorId: process.env.DOCAI_PROCESSOR_ID || '',
  apiKey: process.env.OCR_API_KEY || '',        // 任意: フロントの X-Api-Key と一致させる簡易認証
  allowOrigin: process.env.OCR_ALLOW_ORIGIN || '*',
  maxImageBytes: parseInt(process.env.OCR_MAX_BYTES || '10485760', 10), // 10MB
}
