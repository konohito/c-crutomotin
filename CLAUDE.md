# Cruto Motion（c-crutomotin）— 開発ガイド

## 開発時の必須ルール（全アプリ共通）

1. 開発時はプレビュー環境での作成・テスト確認も必ず行うこと。
2. 3省2ガイドライン（医療情報の安全管理に関するガイドライン）に準拠していない箇所の「洗い出し」と「改善策の提示」を常に行うこと。
3. 3省2ガイドラインに準拠させるための実際のコード改変は、ユーザーから明確な指示があった場合のみ実行すること（勝手に修正しないこと）。

---

## 絶対に変更してはいけない設定

以下は**ユーザーが明示的に承諾済みの設定**であり、絶対に変更しないこと（調査・記述の対象であって、変更対象ではない）。

- `functions/src/visionread.js` の Vertex AI エンドポイント — Gemini によるビジョン読み取りの呼び出し先。
  **`asia-northeast1`（東京）のリージョンエンドポイント**。ホスト名と `locations/` の両方に東京を入れること
  （片方だけだと global へ流れる）。`src/lib/ai-region.test.mjs` が機械的に固定しており、
  `locations/global` を書き戻すと CI が落ちる。
- `functions/src/ai-model.js` の `ALLOWED_MODELS` と `FINGERPRINT` — **7リポジトリ共通**。
  片方だけ直すと検査が落ちる。足すときは東京で 200 が返ることを実測してから。

### ★解除済み（2026-11-10 ユーザー確定）

> 「**文字認識そのものを Gemini（東京）に寄せて Document AI を使わない、という手でお願いします**」

ここには長く **「`DOCAI_LOCATION`（既定 `us`）は絶対に変更しない」**
**「Document AI をやめて Gemini だけにするのはやらないこと」** と書いてあった。
理由は「Document AI に日本リージョンが無いのでどこを選んでも国外」＋「チェック欄の判定が
Document AI の返す座標に依存しているので外すと幾何ロジックごと死ぬ」だった。
**この 2 つの禁止はユーザーの決定で取り消し。** 代わりに次の作りにしてある。

- **どちらで読むかは `OCR_ENGINE`（`functions/src/ocrengine.js`）の 1 か所で決まる。**
  `docai`（既定・従来どおり）/ `gemini`（東京だけ）。**判定を他のファイルに書かないこと**
  （`ai-region.test.mjs` が他ファイルで `OCR_ENGINE` を読んでいないか検査している）。
- `DOCAI_LOCATION` は `OCR_ENGINE=docai` のときだけ効く設定になった。**変更禁止ではない**が、
  どこへ移しても国内にはならないので、国外処理を止めたいなら `OCR_ENGINE=gemini` を使う。

---

## データがどこで処理・保存されるか（2026-09-26 実測 / 2026-11-10 に engine の行を追加）

3省2ガイドラインで必ず聞かれるところ。**推測ではなく、GCP に問い合わせて確認した値**。

| 機能 | リージョン | 確認方法 |
| :-- | :-- | :-- |
| Firestore（測定データ・利用者台帳） | **asia-northeast1（東京）** | `gcloud firestore databases list` |
| Cloud Storage（用紙の画像） | **asia-northeast1（東京）** | `gcloud storage buckets list` |
| Cloud Functions（OCR処理・gen2） | **asia-northeast1（東京）** | `gcloud run services list`（実体の Cloud Run 2本とも東京） |
| Vertex AI / Gemini（ビジョン読み取り） | **asia-northeast1（東京）** | `visionread.js` ＋ `ai-region.test.mjs` で固定 |
| Document AI（文字と座標の認識） | **us（米国）**／`OCR_ENGINE=gemini` では**使わない** | `config.js` の `DOCAI_LOCATION` |
| Hosting | CDN配信 | — |

**保存されるデータはすべて東京。国外へ出るのは Document AI に送る処理の瞬間だけ**
（`OCR_ENGINE=gemini` にすると、その瞬間も無くなる）。

監査で問われたときに言えること（**いまの既定 `docai` の場合**）:
> 保存データはすべて東京リージョン。文字認識の処理のみ米国で行われるが、
> オンライン処理のためディスクに保存されず、学習にも使われない。
> Document AI には日本リージョンが提供されていないため、他リージョンへ移しても国内処理にはならない。
> なお、国外へ一切出さない経路（東京の Gemini だけで読む）を実装済みで、設定1つで切り替えられる。

`OCR_ENGINE=gemini` に切り替えた場合に言えること:
> 保存も処理もすべて東京リージョン。国外へ出る経路は無い。

★この表を直すときは、必ず上のコマンドで実測してから直すこと
（以前この文書が Vertex AI を `locations/global` と書いたまま古くなっており、
　実際のコードは東京だった。2026-09-26 に実態へ合わせた）。

---

## 読み取りの engine を切り替えるときに知っておくこと（2026-11-10 実測）

**2つの engine は「返ってくるものの形」が根本的に違う。** ここが移行でいちばん効く差。

| | `docai`（既定） | `gemini`（東京だけ） |
| :-- | :-- | :-- |
| 返るもの | 文字と**座標** | 文章（JSON）。座標は無い |
| 測定値の取り方 | ラベル行の帯で最も右の数字クラスタを座標から拾う（`mapping.js` の `spatialFallback`） | モデルが「どのマスの数字か」を判断して値を返す |
| 問診票のマーク | 四隅マーカーから用紙座標に引き直し、設問行と列見出しで検算してから塗りの濃さを測る（`kclread.js`） | モデルが直接 はい/いいえ を答える（`visionread.js` の `kclFromVision`） |
| 項目ごとの確信度 | ある（Document AI の confidence） | **無い** → 全件を職員の確認に回す（`VISION_CONF`＜しきい値 ＋ `needsReview` を必ず立てる） |
| 国外へ出るか | **出る**（米国） | 出ない |

### ★一括本登録（職員が1枚も開かずに登録される道）の塞ぎ方

取り込み画面の「自動判定 N 件を一括本登録」を通った用紙は **1 枚も人が開かずに**
`measurements` へ書かれる（`Import.jsx` の `commitReady`）。ここの入口は用紙の種類で違う。

- **記録用紙**… `!rec.needsReview && rangeOk(rec)`。gemini では `needsReview` が必ず立つので通らない
- **問診票**… **`needsReview` を見ていない**。ゲートは `src/ui/kclanswers.jsx` の `kclAutoOk` だけ

★だから問診票は `ocrengine.js` の `needsReview = true` では塞げない。
`kclAutoOk` が **`via === 'vision'`（幾何ロジックの検算を一度も通っていない読み）を
必ず false にする**ことで塞いでいる。`scripts/check-kcl-autook.mjs`（13件）が固定する。

> **2026-11-10 に塞いだ穴。** これは gemini 対応で**新しく開いた穴ではなく、前から開いていた**。
> docai でも「文字認識ごと失敗して Gemini 単独で救われた用紙」は `via: 'vision'` になり、
> 検算を一度も通らないまま自動で登録されていた（本番 716 枚中 **211 枚＝29.5%** がこの道）。
> しかも職員が答えを直した率はこの経路がいちばん高い（幾何ロジック 0% に対し **14.2%**）。
> → **この 211 枚相当（約3割）は、今後は職員が1枚ずつ開いて確認することになる。**
> 手間は増えるが、検算も人の目も通らない回答が登録される状態のほうが危ない。
> 戻したい場合は `kclAutoOk` の `via === 'vision'` の 1 行を外せば元に戻る（非推奨）。

### 精度の実測（移行前 / 移行後を同じ尺度で）

★下の数字の出どころ。**コメントではなく手元で測り直せる形で残す。**
1. の実測は本番 Firestore の読み出し（`recognitions` と `measurements` を
`recognitionId` で突合）＋ Storage に残っている用紙の画像を Gemini で読み直したもの。
2. は `cd functions && STRESS_ENGINE=gemini GCLOUD_PROJECT=cruto-motion node test/kclread.stress.cjs`。
3. は `recognitions` の全件集計。**どれも読み取りのみで、1 件も書き込んでいない。**
1. と 3. の集計スクリプトはリポジトリに置いていない（本番の個人データを読むものを
公開デモを含むリポジトリに入れないため）。測り直すときは
「`recognitions` を collection group で読む → `measurements.recognitionId` で突合 →
`fields[].value` と `values[]` を比べる」で再現できる。

1. **記録用紙（体力測定の数値）・実際の写真60枚・職員が登録した値を正解とした一致率**

   | | 正しく読めた | 取り違え | 読めず |
   | :-- | :-- | :-- | :-- |
   | `docai`（従来） | 222/525 = **42.3%** | 238（51.7%） | 65 |
   | `gemini`（東京） | 489/530 = **92.3%** | 22（4.3%） | 19 |

   → **測定値は gemini が明確に優れている。** 本番の `recognitions` を全件見ると、
   Document AI の**フォームパーサは測定値を1件も取れておらず**、読めた 2191 件は
   **100% が座標フォールバック由来**だった（＝座標付き OCR としてしか使えていない）。

2. **問診票のマーク・合成写真60枚（`functions/test/kclread.stress.cjs`・seed=20260831・同じ乱数列）**

   | | 誤読 | 設問の読取 | 読取不可にせず読めた |
   | :-- | :-- | :-- | :-- |
   | `docai`（従来） | **0 枚** | 631/764 = **83%** | 58/60 |
   | `gemini`（東京） | **15 枚** | 173/764 = **23%** | 40/60 |

   ★**この数字をそのまま「gemini の実力」と読まないこと。** 合成写真は
   `kclharness.cjs` の `glyphs()` が**抽象的なインクの模様を描くだけで、日本語の文字を
   1 文字も描いていない**。一方 `makeDoc()` は Document AI の応答として**本物の設問文**を
   渡している。つまりこの検査は
   「幾何ロジックには正しい文字を渡し、Gemini には読む文字を与えない」構造になっており、
   **docai に有利・gemini に不利**。gemini の 23% は**下限**であって公平な推定ではない。
   （やさしい条件の 1 枚で試すと gemini は 13/13 正解する。崩れるのは傾き・遠近が強い
   写真で、文字が無いため行を数えて当てるしかなくなる場面。）

   ★同じ 60 枚を gemini で読み直すには:
   `cd functions && STRESS_ENGINE=gemini GCLOUD_PROJECT=cruto-motion node test/kclread.stress.cjs`
   （実際に Vertex AI を呼ぶので ADC と課金が必要。CI では既定のまま流す。11 分ほどかかる）

   ★**問診票は実際の写真で測り直せない。** 取り込みが済んだ用紙の画像は職員が削除する
   運用のため、Storage に残っている問診票の写真は 7 枚で、そのうち正解（職員が登録した
   回答）と結びつくものは **0 枚**だった。記録用紙は 207 枚残っていたので上の 1. が測れた。

3. **本番の実績**（`recognitions` 1013 件・読み取りのみで集計。実際の写真・実際の文字）
   - 問診票 716 枚のうち **211 枚（29.5%）は幾何ロジックが読めず、Gemini 単独で救われていた**。
     その 211 枚の設問読取率は **2728/2734 = 99.8%**（＝実写では Gemini は問診票をよく読む）
   - 幾何ロジックだけで読めた写真の設問読取率は `markers` 86.5% / `rows` 79.8%
   - ただし職員が登録した回答と突き合わせると、**直された率**は
     `markers` 0% / `rows` 0% / 統合経路 5〜6% / **Gemini 単独 14.2%**
     （※この突合は、同じ面を撮り直して 2 枚登録した場合を分離できていないので上振れしている）
   - 記録用紙 297 枚のうち **295 枚（99.3%）はすでに要確認**。
     → gemini で全件要確認になっても、**職員の手間はほとんど増えない**
   - 2026-09 の記録に `gemini-3.1-pro-preview`（150件）と `gemini-2.5-pro`（4件）が残っている。
     どちらも現在の `ALLOWED_MODELS` に無い名前で、`ai-model.js` を入れる前の履歴。
     いまは `gemini-3.5-flash`（448件）だけが使われている

### 既定を `docai` のままにしている理由

- 記録用紙（測定値）は **gemini が明確に良い**（実写で 42.3% → 92.3%）
- しかし問診票のマークは、**同じ尺度（合成60枚）で誤読 0 枚 → 15 枚**に増える。
  この検査は gemini に不利な作りだが、**「誤読ゼロ」を下回ったことは事実**なので、
  依頼の最低条件（移行前の基準を下回らないこと）を満たせていない
- 実写では逆に gemini が問診票をよく読んでいる証拠もある（上の 3.）が、
  **問診票を実写で測り直す手段が無い**（写真が残っていない）ため、裏が取れない

→ **切り替えるかどうかはユーザーの判断**。国外処理を止めることを優先するなら
`OCR_ENGINE=gemini` を設定するだけで切り替わり、戻すのも設定を消すだけ。

★`OCR_ENGINE` は engine を**丸ごと**切り替える。用紙の種類ごとに分ける作りにはしていない
（「記録用紙だけ gemini」は技術的には可能だが、判定が増えると
　「この用紙はどちらで読んだか」を追えなくなるので、やるなら別途相談）。

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
- 2026/09/16 に発生した実例（誤って「特定不明」と判断し削除した測定 1 件が、後に持ち主が判明し復元した事故）が、この方式の直接の理由。復元手順は `docs/削除と復元.md` を参照
- 台帳の誤記・取り違えの実例（別の利用者に測定が付いていた等）もあり、`src/lib/audit.js` の点検ロジック（あり得ない値・前回からの急激な変化・同日重複値の検出）はこうした実例をもとに追加されたもの。しきい値を緩める変更は行わないこと
- ★経緯を書き残すときは、**利用者・職員の氏名を書かないこと**（件数と形だけ書く）。このリポジトリは公開デモを含む

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
  - `GEMINI_MODEL` は **Repository Variable が空なら行そのものを書かない**（2026-11-05）。空文字は「設定したが間違えた」として弾かれ、読み取りのたびにエラーが記録に残るため。未設定なら既定の `gemini-3.5-flash` で動く
- 使うモデルを決めているのは `functions/src/ai-model.js` の1か所だけ。**既定は `gemini-3.5-flash`** で、環境変数 `GEMINI_MODEL` を設定しなければ動きは変わらない。許可の表（`ALLOWED_MODELS`）に無い名前を入れると、使わずに既定へ倒して理由つきで記録に残す。表は7リポジトリ共通で `FINGERPRINT` で固定してあり、片方だけ直すと検査が落ちる

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

---

## 承認済み職員だけがデータに触れる（★2026-10-22・嘉島町役場からの照会を機に修正）

**職員の承認（`staff/{uid}` の有無）は3か所で見る。1か所だけ直すと穴が開く。**

| | 場所 | 条件 |
| :-- | :-- | :-- |
| ① データベース | `firestore.rules` の `isStaff()` | `exists(.../staff/$(request.auth.uid))` |
| ② 用紙の画像 | `storage.rules` の `isStaff()` | `firestore.exists(/databases/(default)/documents/staff/...)`（クロスサービス参照） |
| ③ 文字読み取りの入口 | `functions/index.js` の `requireStaff()` | ID トークン検証 ＋ `staff/{uid}` の存在 |

**修正前に何が起きていたか。** ①だけが職員を要求し、②③は「ログインしていれば誰でも」だった。
Firebase Auth の self-signup が開いているため、第三者が作ったアカウントや
電子手帳の利用者アカウント（`portalUsers`）からでも、
**氏名が写った記録用紙の画像を読めて、しかも削除できた**。
③は `cfg.apiKey` が空のとき検査ごと飛ばす実装で、CI が作る `.env` に `OCR_API_KEY` が
入っていないため常に空＝実質無認証の公開エンドポイントだった（Document AI を誰でも回せた）。

**守り方。** `scripts/check-rules-staff.mjs`（25件・`npm run check` に登録）が3か所をまとめて検査する。
「ログインしていれば通す」書き方に戻すと落ちる。

**★エミュレータでは検証できない。**
この端末の Java は x86 専用で Firebase エミュレータが起動しない（`Bad CPU type in executable`）。
加えて **Storage エミュレータはクロスサービス参照に対応していない**ので、動いても②は検証できない。
→ **本番に出したら、職員アカウントで「取込」「当日参加」の画面を開き、
用紙の画像が表示されることを実機で必ず確かめること。** 表示されなければ②を戻して報告する。

**影響範囲の確認（2026-10-22 実コードで確認）。**
`sheets/` に触るのは `src/lib/db.js:50`（アップロード）と
`sheetImageUrl` / `deleteSheetImage`（`src/screens/Import.jsx` / `WalkIn.jsx` / `Mobile.jsx`）だけ。
いずれも `AuthGate` の職員側の分岐にしか無いので、**職員の操作は何も変わらない**。
電子手帳の利用者は `sheets/` を一度も読まない。
`onSheetImageUpload`（取り込みパイプライン）は Admin SDK なのでルールの対象外＝影響なし。

**まだ残っているもの（コードでは直せない）。**
Firestore の時点復旧（PITR）が未設定。これは GCP 側の設定なので、運用者が次の1行を実行する。
```bash
gcloud firestore databases update --database='(default)' --enable-pitr --project cruto-motion
```
