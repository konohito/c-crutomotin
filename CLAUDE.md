# Cruto Motion（c-crutomotin）— 開発ガイド

## 開発時の必須ルール（全アプリ共通）

1. 開発時はプレビュー環境での作成・テスト確認も必ず行うこと。
2. 3省2ガイドライン（医療情報の安全管理に関するガイドライン）に準拠していない箇所の「洗い出し」と「改善策の提示」を常に行うこと。
3. 3省2ガイドラインに準拠させるための実際のコード改変は、ユーザーから明確な指示があった場合のみ実行すること（勝手に修正しないこと）。

---

## 絶対に変更してはいけない設定

以下は**ユーザーが明示的に承諾済みの設定**であり、絶対に変更しないこと（調査・記述の対象であって、変更対象ではない）。

- `functions/src/config.js` の `DOCAI_LOCATION`（既定 `us`）— Document AI のロケーション。
  **Document AI には日本リージョンが無い**（公式: マルチリージョンは us / eu のみ、単一リージョンにも東京は無い）。
  どこを選んでも国外になるため us のままにしている。使うのは `processDocument`（オンライン処理）だけで、
  ディスクに保存されず学習にも使われない。理由の全文は `functions/src/config.js` のコメントにある。
- `functions/src/visionread.js` の Vertex AI エンドポイント — Gemini によるビジョン読み取りの呼び出し先。
  **`asia-northeast1`（東京）のリージョンエンドポイント**。ホスト名と `locations/` の両方に東京を入れること
  （片方だけだと global へ流れる）。`src/lib/ai-region.test.mjs` が機械的に固定しており、
  `locations/global` を書き戻すと CI が落ちる。

---

## データがどこで処理・保存されるか（2026-09-26 実測）

3省2ガイドラインで必ず聞かれるところ。**推測ではなく、GCP に問い合わせて確認した値**。

| 機能 | リージョン | 確認方法 |
| :-- | :-- | :-- |
| Firestore（測定データ・利用者台帳） | **asia-northeast1（東京）** | `gcloud firestore databases list` |
| Cloud Storage（用紙の画像） | **asia-northeast1（東京）** | `gcloud storage buckets list` |
| Cloud Functions（OCR処理・gen2） | **asia-northeast1（東京）** | `gcloud run services list`（実体の Cloud Run 2本とも東京） |
| Vertex AI / Gemini（ビジョン読み取り） | **asia-northeast1（東京）** | `visionread.js` ＋ `ai-region.test.mjs` で固定 |
| Document AI（文字と座標の認識） | **us（米国）** | `config.js` の `DOCAI_LOCATION` |
| Hosting | CDN配信 | — |

**保存されるデータはすべて東京。国外へ出るのは Document AI に送る処理の瞬間だけ。**

監査で問われたときに言えること:
> 保存データはすべて東京リージョン。文字認識の処理のみ米国で行われるが、
> オンライン処理のためディスクに保存されず、学習にも使われない。
> Document AI には日本リージョンが提供されていないため、他リージョンへ移しても国内処理にはならない。

★この表を直すときは、必ず上のコマンドで実測してから直すこと
（以前この文書が Vertex AI を `locations/global` と書いたまま古くなっており、
　実際のコードは東京だった。2026-09-26 に実態へ合わせた）。

---

## リポジトリの構成（データの流れ）

介護予防事業の体力測定を、紙の記録用紙からデータ活用まで一気通貫で扱う業務アプリ。

```
① 撮影/画像選択（モバイル撮影 or 用紙アップロード）
     ↓ Cloud Storage(sheets/{batchId}/…) 保存
② OCR取込（Google Document AI + Vertex AI/Gemini によるビジョン読み取りの併用）
     ↓ 記録用紙スキーマへマッピング（functions/src/mapping.js, kclread.js, visionread.js）
③ 読み取りキュー（Firestore batches/{id}/recognitions）→ 取り込み画面で職員が確認・照合
④ 測定データ登録（Firestore measurements/{利用者ID}_{測定日}）
⑤ 提出書式出力（行政提出用 CSV・個人結果票 PDF）
```

- フロント: Vite + React 18（`src/`）。チャートは外部ライブラリ不使用の自前 SVG
- バックエンド: Firebase Functions（`functions/`）。HTTPS 関数 `recognizeSheet` と Storage トリガ `onSheetImageUpload`
- データ層: Firestore（`users` / `measurements` / `batches` / `walkins` / `techo` / `staff` / `portalUsers` / `deletedRecords` / `deletionLogs` など）
- 詳細な構成図・データモデルは `docs/OCR-BACKEND.md`、実データ取込みの流れは `docs/実データ取り込み.md` を参照

### 測定キーと削除方式（既存の重要な前提・変更禁止）

- 測定 1 件のキーは **`{利用者ID}_{測定日}`**（`measurements/{userId}_{date}`）
- 利用者・測定の削除は**必ずアーカイブ（控え）方式**で行う。`src/lib/deletion.js` の順序（① `deletedRecords` に控えを書く → ② 書けたことを確認 → ③ 本体を削除 → ④ `deletionLogs` に監査ログを残す）を厳守する。控えを取らずに消す経路を新設しないこと
- 2026/09/16 に発生した実例（誤って「特定不明」と判断し削除した測定が、後に**山下芳代様**のものと判明し復元した事故）が、この方式の直接の理由。復元手順は `docs/削除と復元.md` を参照
- **桝田幸穂様**のデータについても台帳の誤記・取り違えの実例があり、`src/lib/audit.js` の点検ロジック（あり得ない値・前回からの急激な変化・同日重複値の検出）はこうした実例をもとに追加されたもの。しきい値を緩める変更は行わないこと

---

## ビルド手順

```bash
npm install
npm run dev            # ローカル開発サーバー（http://localhost:5173/c-crutomotin/）
npm run build           # 公開デモ用ビルド（dist/、シードデータ、認証なし）
npm run build:hosting   # 本番用ビルド（--mode hosting。.env.hosting の VITE_FIREBASE_CONFIG を読む。base=/）
npm run build:smoke     # スモークテスト用ビルド（vite.smoke.config.mjs）
```

- 公開デモ（GitHub Pages）＝シードデータのみ・ログイン不要。実データは一切含まない
- 本番（Firebase Hosting）＝実データ（Firestore）・職員ログイン必須

## テスト手順

```bash
npm run check           # 以下をまとめて実行
npm run check:undefined # src 全体の未定義参照（実行時 ReferenceError）を静的解析で洗い出す
npm run check:screens   # 全画面を実際に描画してみるスモークテスト（読み取り専用）
npm run check:values    # 測定値の点検ロジック（audit.js/validate.js）のテスト＋台帳走査
npm run check:measure   # 測定の保存まわりの回帰テスト（Firestore には繋がずメモリ内のみ）
```

- `check:screens` / `check:values` は `DATA=/path/to/data.json` を指定すると本番から吸い出した実データ（`{ users, measurements }`）でも走査できる
- バックエンド（`functions/`）のテストは別建て:
  ```bash
  cd functions
  npm test          # 単体テスト（mapping / recognition / mockdoc / visionread / kclread）
  npm run test:e2e  # エミュレータでの通し検証（Storage→トリガ→OCR(モック)→Firestore）
  ```

## デプロイ手順

### GitHub Actions（自動）

| ワークフロー | トリガ | 内容 |
|---|---|---|
| `.github/workflows/deploy.yml` | `main` への push | GitHub Pages へ公開デモ（`npm run build`）を自動デプロイ |
| `.github/workflows/deploy-production.yml` | `main` / `production` への push | 本番一式（Hosting + Functions + Firestore/Storage ルール・インデックス）を WIF（鍵レス認証）でデプロイ |
| `.github/workflows/deploy-hosting.yml` | 手動（`workflow_dispatch`） | Hosting のみの予備デプロイ窓口（旧 SA 鍵方式。通常は使わない） |
| `.github/workflows/deploy-functions.yml` | 手動（`workflow_dispatch`） | バックエンド（Functions + ルール）のみの予備デプロイ窓口 |

- 本番デプロイの認証は **Workload Identity Federation（鍵レス）**。必要な Repository Variables: `GCP_WIF_PROVIDER` / `GCP_DEPLOY_SA` / `FIREBASE_PROJECT_ID` / `DOCAI_PROCESSOR_ID`（Secrets/Variables 未設定の間は自動でスキップし、ジョブは失敗しない設計）
- `functions/.env`（`DOCAI_LOCATION` / `DOCAI_PROCESSOR_ID` / `OCR_ALLOW_ORIGIN` / `GEMINI_MODEL` / `VISION_READ`）は CI 上で Repository Variables から都度生成される（gitignore 済みでリポジトリには置かない）

### 手動デプロイ

```bash
# フロント（本番）
npm run build:hosting && npx firebase deploy --only hosting --project cruto-motion

# バックエンド一式
cd functions && npm install && npm test
npx firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project cruto-motion
```

## プレビュー環境の使い方

1. **ローカルプレビュー**（ビルド後の成果物をローカルで確認。実データ・認証は使わない）
   ```bash
   npm run build:hosting   # または npm run build（デモデータ）
   npm run preview         # vite preview。http://localhost:4173 で dist/ を配信
   ```
2. **Firebase Hosting のプレビューチャンネル**（本番プロジェクトに影響を与えず、実際の Firestore/Functions に繋いだ状態で確認できる。**使用可能な構成であることを確認済み**＝`firebase.json` の hosting はサイト/ターゲット指定なしのデフォルト構成なのでそのまま使える）
   ```bash
   npm run build:hosting
   npx firebase hosting:channel:deploy <任意のプレビュー名> --project cruto-motion --expires 3d
   # 例: npx firebase hosting:channel:deploy preview-role-fix --project cruto-motion --expires 3d
   ```
   発行される一時 URL（`https://cruto-motion--<プレビュー名>-xxxx.web.app`）で確認する。期限（`--expires`）を必ず指定し、確認後は不要になったら `npx firebase hosting:channel:delete <名前> --project cruto-motion` で削除する
3. **バックエンド（Functions/OCR パイプライン）のローカル検証**（GCP 資格情報不要）
   ```bash
   cd functions
   npx firebase emulators:start --only functions,firestore,storage,auth --project demo-cruto
   npm run test:e2e   # 別ターミナルから通し検証
   ```
4. 実 Document AI / Vertex AI で確認する場合は `functions/.env` に `DOCAI_*` を設定し ADC（`gcloud auth application-default login`）を用意した上で `npm run serve`（`docs/OCR-BACKEND.md` 参照）

**注意**: 公開デモ（GitHub Pages）はシードデータのみで実データを含まないため、実データに関わる変更（削除・権限・測定登録まわりなど）の確認は、公開デモではなく上記 2 のプレビューチャンネルか、ローカルエミュレータ（上記 3）で行うこと。

---

## 今後の開発フロー（PR→プレビュー確認→マージ）に向けた現状

想定フロー：①「〇〇を実装して新しいブランチでPRを作成して」と指示 → ②GitHub Actionsが走り、数分後にiPhoneへ「プレビューURL」が通知される → ③iPhoneのブラウザでURLを開き動作確認 → ④問題なければiPhoneのGitHubアプリから「Merge」で本番デプロイ。

このフローの実現状況を `.github/workflows/` 全4ファイル（`deploy.yml` / `deploy-hosting.yml` / `deploy-production.yml` / `deploy-functions.yml`）を確認した結果でまとめる。

### 1. PRを作ると自動でプレビュー環境が発行される仕組み → **無い**

4つのワークフローすべてのトリガーを確認したが、`pull_request` トリガーは**1つも存在しない**。

| ワークフロー | トリガー |
|---|---|
| `deploy.yml` | `push: [main]`、`workflow_dispatch` |
| `deploy-hosting.yml` | `workflow_dispatch` のみ |
| `deploy-production.yml` | `push: [main, production]`、`workflow_dispatch` |
| `deploy-functions.yml` | `workflow_dispatch` のみ |

つまり現状は「PRを作る」→「自動でプレビューが立つ」という経路が存在せず、`main`/`production` への push（＝実質マージ）で直接本番へデプロイされる構成になっている。Firebase Hosting のプレビューチャンネル関連のコマンド・ワークフローもリポジトリ内に存在しない。

### 2. プレビューURLの通知の仕組み（LINE WORKS・Slack・メール等） → **無い**

リポジトリ全体（ワークフロー・関数・スクリプト）を `slack` / `LINE WORKS` / `webhook` / `smtp` 等のキーワードで検索したが、通知を送信するコードは見つからなかった。`docs/ロードマップ.md` に「該当スタッフへの LINE WORKS Bot 通知」という**将来構想メモ**はあるが、これは予定登録の通知に関するアイデアであり、CI/プレビューURL通知とは無関係かつ未着手。

### 3. Firebase Hosting プレビューチャンネルでの実現案（提案のみ・未実装）

`firebase.json` の `hosting` はターゲット指定のないデフォルト構成なので、`firebase hosting:channel:deploy` はそのまま使える。以下は導入する場合の概要（**実装はしていない**）。

1. **新しいワークフローを追加**（例 `.github/workflows/preview.yml`）。トリガーは `pull_request: [opened, synchronize, reopened]`
2. `npm ci && npm run build:hosting` でビルド（本番と同じ実データ接続構成でプレビューしたいので `build:hosting` を使う想定。デモ扱いでよければ `npm run build` でも可）
3. 認証は `deploy-production.yml` と同じ **WIF（鍵レス）** を流用（`GCP_WIF_PROVIDER` / `GCP_DEPLOY_SA` / `FIREBASE_PROJECT_ID` は既存の Repository Variables をそのまま使える）
4. デプロイは公式アクション `FirebaseExtended/action-hosting-deploy@v0` を使うと、**発行されたプレビューURLを自動でPRにコメント**してくれる（チャンネルIDは例えば `pr-${{ github.event.pull_request.number }}`、`expires: 7d` 程度を推奨）
   - このアクションが打つPRコメント自体が、GitHubアプリの通知（プッシュ通知）としてiPhoneに届く。これだけで「②数分後にiPhoneへプレビューURLが通知される」の大部分は満たせる可能性が高い（GitHub側の通知設定に依存）
   - LINE WORKS 等の通知が別途必要な場合は、同じワークフローの後続ステップで Webhook POST を追加する必要がある（Webhook URL 等のSecretsの追加登録が別途必要。現状ゼロから用意する作業になる）
5. PRクローズ時に `hosting:channel:delete` するクリーンアップ処理も合わせて用意するのが望ましい（放置するとプレビューチャンネルが溜まる）

### 4. Cloud Functions（Document AI・Vertex AI連携）のプレビューに関する制約

- **Firebase Hosting のプレビューチャンネルは Hosting（静的配信）だけを切り替える機能であり、Cloud Functions 自体はプレビュー化されない。** `firebase.json` の `hosting.rewrites` は `"**" → /index.html`（SPA用）のみで Functions へのリライトは無いため、この点自体はシンプルだが、フロントは `VITE_OCR_ENDPOINT` で **本番の Functions URL を直接叩く**構成（`recognizeSheet` は `asia-northeast1-<project>.cloudfunctions.net/recognizeSheet`）。したがって、プレビューチャンネルで確認作業（OCR取込・測定登録・削除など）を行うと、**その操作は実際には本番の Firestore/Storage/Functions に対して行われる**。テスト目的の操作が本番データに影響し得る点に注意が必要（現状 staging 用の別 Firebase プロジェクトは存在しない）
- **`DOCAI_LOCATION` 等の環境変数を誤って変更しないための注意点**：
  - プレビュー用ワークフローは `firebase deploy --only hosting:<channelId>` のように **Hosting のみ**をデプロイ対象にすること。`--only functions` や `--only functions,firestore:rules,...` を含めると、`deploy-production.yml`/`deploy-functions.yml` と同様に `functions/.env` を Repository Variables から生成するステップが必要になり、そこで `DOCAI_LOCATION`（既定 `us`）を上書きしてしまうリスクが生まれる
  - **プレビュー用ワークフローには Functions のデプロイ・`.env` 生成ステップを含めないことを原則とする**（Functions は既存の `deploy-production.yml`/`deploy-functions.yml` にのみ委ねる）
  - `DOCAI_LOCATION` と Vertex AI エンドポイント（`visionread.js` の `asia-northeast1`）は本ファイル冒頭の「絶対に変更してはいけない設定」に該当する。プレビュー環境整備の作業であっても、この2点には一切手を触れないこと

---

## 参考ドキュメント

- `docs/OCR-BACKEND.md` — OCR バックエンドのアーキテクチャ・セットアップ・セキュリティ注意点
- `docs/実データ取り込み.md` — 実データ（嘉島町 介護予防健診データ）の取込み手順・Firestore データモデル
- `docs/削除と復元.md` — 削除の流れと控えからの復元手順、**職員の権限区分が無い点の明記**
- `docs/運用者チェックリスト.md` — 運用者（GCP/Firebase 契約者）側の残タスク
- `docs/ロードマップ.md` — 将来構想メモ
