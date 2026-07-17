# Cruto Motion — 介護予防・体力測定管理システム

高齢者介護予防事業の体力測定を、紙の記録用紙からデータ活用まで一気通貫で支える業務アプリケーションです。
レトロモダンな帳票文化と、Apple 的に洗練された操作感を両立したデザインで実装しています。

**Live demo**: https://konohito.github.io/c-crutomotin/

## 主な機能

| 画面 | 内容 |
| --- | --- |
| ダッシュボード | 本日の測定会・参加状況・要確認の用紙・運動機能の推移を一望 |
| 取り込み | 記録用紙のスキャン読み取り（Cloud Vision 想定）→ 信頼度による自動振り分け → 確認 → 本登録 |
| 読み取り確認 | スキャン画像と読み取り値の突き合わせ、氏名照合、修正候補チップ、欠測処理 |
| 利用者情報取り込み | 名簿・記録 CSV の一括登録（Shift_JIS / UTF-8 自動判定、ID→氏名照合、測定値も登録） |
| 利用者台帳 | 圏域・市町村・状態フィルタ、スコア順/低下順ソート、スパークライン付き一覧 |
| 個人詳細 | 5領域レーダーチャート、年次推移、8項目スパークライン、参加履歴、気づきメモ |
| 集計分析 | 圏域×年度の推移（全参加者/同一集団コホート切替）、分布ヒストグラム、領域ヒートマップ |
| カレンダー | 測定会・教室・会議の予定管理、スタッフアサイン、新規地域の追加 |
| PDF 出力 | A4 個人結果票（レーダー・推移・コメント付き）を 1 名 / 市町村 / 全員で一括印刷 |
| 用紙作成 | OCR 読み取り対応の記録用紙（位置合わせマーカー・1マス1桁記入枠・ID ビットストリップ） |
| モバイル撮影 | 現場スタッフ用撮影フローの操作可能デモ（iOS デバイスフレーム） |

## 技術構成

- **Vite + React 18**（チャートはすべてハンドロールの SVG、外部チャートライブラリ不使用）
- シードつき乱数によるモックデータエンジン（利用者 400 名 × 6 年度の測定データ、OCR バッチ 48 枚）
- デザイントークン: Cruto Orange × cool slate、Noto Sans JP / Inter（tabular-nums）/ Mohave italic / Yomogi
- `@media print` による A4 帳票の実印刷対応
- GitHub Actions → GitHub Pages 自動デプロイ

## 開発

```bash
npm install
npm run dev      # http://localhost:5173/c-crutomotin/
npm run build    # dist/ に出力
```

`main` ブランチへの push で GitHub Pages へ自動デプロイされます。

## 本番接続（実データ OCR / Firestore / 職員ログイン）

デモは環境変数なしで動きます。実データに接続する場合:

1. `bash scripts/setup-gcp.sh` — GCP / Firebase / Document AI / 職員ログインを対話式で一括セットアップ
2. リポジトリ Secrets に `OCR_ENDPOINT` / `FIREBASE_CONFIG` を登録して再デプロイ

手順の全体像は [`docs/運用者チェックリスト.md`](docs/運用者チェックリスト.md)、
技術詳細は [`docs/OCR-BACKEND.md`](docs/OCR-BACKEND.md) を参照。
