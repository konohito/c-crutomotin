# functions — 記録用紙 OCR バックエンド

Firebase Functions（Node 20）+ Google Document AI による記録用紙 OCR の HTTPS 関数 `recognizeSheet`。

セットアップ・デプロイ手順の全文は [`../docs/OCR-BACKEND.md`](../docs/OCR-BACKEND.md) を参照。

## クイックリファレンス

```bash
npm install
npm test          # mapping.js の単体テスト（GCP 不要）
npm run serve     # ローカルエミュレータ
npm run deploy    # firebase deploy --only functions
```

## API

`POST recognizeSheet`

ヘッダー: `OCR_REQUIRE_AUTH=1` の場合は `Authorization: Bearer <Firebase ID トークン>` が必須
（フロントは職員ログイン中なら自動添付）。`OCR_API_KEY` 設定時は `X-Api-Key` も必要。

```jsonc
// リクエスト
{ "imageBase64": "…", "mimeType": "image/jpeg" }   // または { "gcsUri": "gs://…" }

// レスポンス
{
  "ok": true,
  "sheet": {
    "ocrName": "山田花子", "ocrKana": "ヤマダハナコ", "ocrId": "10023", "nameConf": 98,
    "fields": {
      "walk5":  { "value": 0.8,  "raw": "0.8",  "conf": 93 },
      "balR":   { "value": 27.1, "raw": "27.1", "conf": 90 }
      // … balL / gripR / gripL / tug / height / weight
    }
  }
}
```

`conf` は 0–100（Document AI の confidence を百分率化）。フロントは `conf < 80` を「要確認」に振り分ける。

## 関数一覧

| 関数 | 種別 | 役割 |
|---|---|---|
| `recognizeSheet` | HTTPS | 画像 1 枚を同期認識して返す（フロントの単票読み取り用） |
| `onSheetImageUpload` | Storage トリガ | `sheets/{batchId}/…` への画像アップロードで発火し、Document AI 認識結果を Firestore の読み取りキュー `batches/{batchId}/recognitions` に保存（フェーズ2 非同期パイプライン） |
