'use strict'
/* 環境変数から設定を読み込む。Cloud Functions では GCLOUD_PROJECT が自動設定される。
   ローカルエミュレータでは functions/.env を使う(.env.example を参照)。 */
module.exports = {
  project: process.env.DOCAI_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '',
  /* Document AI のロケーション。
     ★2026-09-25 ユーザーと確認のうえ 'us' のままにした。理由を残す。

     ・**Document AI には日本リージョンが無い**（公式: マルチリージョンは us / eu のみ。
       単一リージョンはムンバイ・シンガポール・シドニー・ロンドン・フランクフルト・
       アムステルダム・モントリオール。東京は無い）。
       https://docs.cloud.google.com/document-ai/docs/regions
     ・つまりどこを選んでも国外で処理される。シンガポールへ移しても「国内」にはならず、
       プロセッサの作り直し（リージョンに紐づく）と読み取り精度の再確認が発生するだけ。
     ・**保存はされない**。このアプリが使うのは processDocument（オンライン処理）だけで、
       batchProcess も人によるレビュー(HITL)も使っていない。Google 公式の原文:
         "For online (immediate response) operations, the document data (sent in the request)
          is processed in memory, encrypted in flight, and not persisted to disk."
         "No. Google does not use any of your content (such as documents and predictions)
          for any purpose except to provide you with the Document AI service."
         "At Google Cloud, we never use customer data to train our Document AI models."
       https://docs.cloud.google.com/document-ai/docs/security
     ・3省2ガイドラインで聞かれたときに言えること:
       「国外で処理されるが、オンライン処理のためディスクに保存されず、学習にも使われない」。
       ※ HIPAA 準拠とも書かれているが、これは米国法であり日本の要件を満たす根拠にはならない。

     ★Document AI をやめて Gemini だけにするのは**精度が落ちるのでやらないこと**。
       チェック欄の判定（kclread）は Document AI が返す文字の**座標**に依存しており、
       外すと幾何ロジックごと死ぬ。ビジョンAIはそれを補う3つ目の目であって、代わりではない。

     監査等で国外処理が問題になった場合は、この1行をシンガポール等へ変えれば切り替わる
     （事前にそのリージョンで Form Parser のプロセッサを作成しておくこと）。 */
  location: process.env.DOCAI_LOCATION || 'us',
  processorId: process.env.DOCAI_PROCESSOR_ID || '',
  apiKey: process.env.OCR_API_KEY || '',        // 任意: フロントの X-Api-Key と一致させる簡易認証
  allowOrigin: process.env.OCR_ALLOW_ORIGIN || '*',
  maxImageBytes: parseInt(process.env.OCR_MAX_BYTES || '10485760', 10), // 10MB
  reviewThreshold: parseInt(process.env.OCR_REVIEW_THRESHOLD || '80', 10), // 要確認しきい値(%)。フロントの CONF_THRESHOLD と揃える
}
