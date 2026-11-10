'use strict'
/* 環境変数から設定を読み込む。Cloud Functions では GCLOUD_PROJECT が自動設定される。
   ローカルエミュレータでは functions/.env を使う(.env.example を参照)。 */
module.exports = {
  project: process.env.DOCAI_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '',
  /* Document AI のロケーション。
     ★2026-11-10 ユーザーが「文字認識を Gemini（東京）に寄せて Document AI を使わない」
       方向に舵を切った。どちらで読むかは **OCR_ENGINE**（functions/src/ocrengine.js）で
       切り替える。OCR_ENGINE=gemini のときこの値は一度も使われない。
       以前ここに書いていた「Document AI をやめて Gemini だけにするのはやらないこと」は
       この決定で**取り消し**。経緯として下に理由を残す。

     ★2026-09-25 時点の判断（'us' のままにした理由）。OCR_ENGINE=docai のときはこれが効く。

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

     ★この経路で何が座標に依存しているか（Gemini へ寄せるときに失うもの）。
       チェック欄の判定（kclread.js）は Document AI が返す文字の**座標**を使う。
       四隅マーカーから用紙座標に引き直し、設問の文字行の位置と突き合わせて検算し、
       「はい・いいえ」の列を文言で確かめてから塗りの濃さを測る。
       測定値（mapping.js の spatialFallback）も「ラベルと同じ行の帯で最も右にある
       数字クラスタ＝記入枠」を座標から拾っている。
       Gemini は座標を返さず、どのマスの数字かをモデル自身が判断して値を返すので、
       この検算の仕組みは使えない。代わりに**全件を職員の確認に回す**ことで守る
       （functions/src/ocrengine.js の needsReview と visionread.js の VISION_CONF）。

     監査等で国外処理が問題になった場合の選択肢は 2 つ。
       1) OCR_ENGINE=gemini にする（東京のみ。国外へ出る経路が無くなる）
       2) この1行をシンガポール等へ変える（国内にはならない。事前にそのリージョンで
          Form Parser のプロセッサを作成しておくこと） */
  location: process.env.DOCAI_LOCATION || 'us',
  processorId: process.env.DOCAI_PROCESSOR_ID || '',
  apiKey: process.env.OCR_API_KEY || '',        // 任意: フロントの X-Api-Key と一致させる簡易認証
  allowOrigin: process.env.OCR_ALLOW_ORIGIN || '*',
  maxImageBytes: parseInt(process.env.OCR_MAX_BYTES || '10485760', 10), // 10MB
  reviewThreshold: parseInt(process.env.OCR_REVIEW_THRESHOLD || '80', 10), // 要確認しきい値(%)。フロントの CONF_THRESHOLD と揃える
}
