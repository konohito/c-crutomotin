# 嘉島町 — 安全管理措置に関する回答書

一般介護予防事業（地区巡回型介護予防検診）委託事業について、嘉島町から求められた
安全管理措置の確認資料（証跡）一式。

| ファイル | 用途 |
| --- | --- |
| `返信文.md` | 嘉島町へ送るメール本文案 |
| `回答書.html` | 回答書の原稿（これを編集して PDF を作り直す） |
| `回答書.pdf` | 提出物。A4・6 ページ |
| `図1-システム概要図.png` | 回答書 2 ページ目の図（単体で使う場合用） |
| `表1-データ保存場所.png` | 回答書 3 ページ目の表 |
| `表2-消去の対象と方法.png` | 回答書 4 ページ目の表 |

## 送付前に埋めるところ

`回答書.html` と `返信文.md` の **■** を検索して置き換える。

- 所在地
- 代表者名
- 本件担当（部署・氏名・連絡先）

## 作り直しかた

`回答書.html` を編集してから:

```bash
node - <<'EOF'
import('/opt/node22/lib/node_modules/playwright/index.mjs').then(async ({ chromium }) => {
  const OUT = 'docs/kashima'
  const b = await chromium.launch()
  const p = await b.newPage({ deviceScaleFactor: 2 })
  await p.goto('file://' + process.cwd() + '/' + OUT + '/回答書.html', { waitUntil: 'networkidle' })
  await p.pdf({ path: `${OUT}/回答書.pdf`, format: 'A4', printBackground: true,
    margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' } })
  for (const [sel, name] of [['#fig1','図1-システム概要図.png'],['#tbl1','表1-データ保存場所.png'],['#tbl2','表2-消去の対象と方法.png']])
    await (await p.$(sel)).screenshot({ path: `${OUT}/${name}` })
  await b.close()
})
EOF
```

各 `section.page` の高さが **1002px（A4 の余白内）を超えないこと**。超えるとページが割れる。

## 回答の根拠（コード上の裏付け）

| 回答書の記載 | 裏付け |
| --- | --- |
| 承認された職員のみがデータにアクセスできる | `firestore.rules` の `isStaff()`（`staff/{uid}` がある者のみ許可。self-signup では読めない） |
| 記録用紙画像は認証済み職員のみ | `storage.rules` |
| 処理は東京リージョン | `functions/index.js` `setGlobalOptions({ region: 'asia-northeast1' })` |
| 削除の控えは職員からも読めない | `firestore.rules` の `deletedRecords`（`allow read: if false`）、`docs/削除と復元.md` |
| 消去対象のコレクション一覧 | `firestore.rules` の `match /<コレクション>/` 一覧 |
| ISMAP 登録 | Google Cloud 公式ブログ（2021/3/18、2023/11/13）— GCP・Firebase とも登録済み |

## 未対応（送付前に確認が必要）

- **AI 読み取りのリージョン**。`functions/src/visionread.js` の Vertex AI 呼び出しは
  `locations/global` エンドポイント、`functions/src/config.js` の Document AI は既定 `us`。
  回答書は「東京リージョン」と記載しているため、**リージョンを日本国内に固定するか、記載を改めるか**の
  いずれかが必要。
- **委託終了時の一括消去スクリプトが未整備**。現状、消去は手作業になる。
  `deletedRecords` を含む全コレクションを消す運用手順またはスクリプトを用意しておくこと。
