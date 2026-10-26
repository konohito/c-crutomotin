/* 承認済み職員だけがデータに触れることを、3か所まとめて守る検査（★2026-10-22 新設）
 *
 * ★なぜ要るか
 *   嘉島町役場からのセキュリティ照会を機に点検したところ、
 *   firestore.rules は `isStaff()`（管理者が staff/{uid} を作った職員だけ）を要求しているのに、
 *   **storage.rules と recognizeSheet だけが「ログインしていれば誰でも」になっていた**。
 *   氏名が写った記録用紙の画像を、電子手帳の利用者アカウントや
 *   自分で作ったアカウントから読めて、しかも消せた。
 *
 *   承認の仕組みは3か所に散っている。1か所だけ直すと同じ穴が開くので、ここでまとめて守る。
 *     ① firestore.rules      … データベース
 *     ② storage.rules        … 用紙の画像
 *     ③ functions/index.js   … 文字読み取りの入口（recognizeSheet）
 *
 * ★エミュレータでは確かめられない
 *   この端末の Java が x86 専用で Firebase エミュレータが起動しない。
 *   加えて **Storage エミュレータはクロスサービス参照（firestore.exists）に対応していない**ため、
 *   仮に動いてもここは検証できない。だから静的検査で守る。
 *   本番に出したら「職員で用紙の画像が見えるか」を実機で必ず確かめること。
 *
 * 実行: node scripts/check-rules-staff.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }

console.log('== ⓪ クロスサービスに必要な権限が書き残されているか（★2026-10-26）==')
{
  /* ★ここで4日間、写真アップロードが全部止まった。
       storage.rules の firestore.exists(...) は、Google 側で
       roles/firebaserules.firestoreServiceAgent を付けないと参照が失敗し、
       承認済みの職員でも全部断られる。
       静的検査では権限そのものを確かめられないので、
       **ルールを触る人が必ず目にする場所に書いてあること**を守る。 */
  const S = read('storage.rules')
  if (/firestore\.(exists|get)\(/.test(S)) {
    ok(/roles\/firebaserules\.firestoreServiceAgent/.test(S),
      '★クロスサービスを使っているのに、必要な権限の名前が storage.rules に書かれていない')
    ok(/gcp-sa-firebasestorage\.iam\.gserviceaccount\.com/.test(S),
      '★権限を付ける相手（Storage の仕組み用アカウント）が書かれていない')
    ok(/実際に1枚上げて/.test(S),
      '★配信後に実機で確かめる、という注意が書かれていない')
  }
}

console.log('== ① firestore.rules ==')
{
  const S = read('firestore.rules')
  ok(/function isStaff\(\)/.test(S), 'isStaff() が無い')
  ok(/exists\(\/databases\/\$\(database\)\/documents\/staff\/\$\(request\.auth\.uid\)\)/.test(S),
    '★isStaff() が staff/{uid} を見ていない')
  ok(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(S),
    '明示の全拒否が無い（既定で閉じてはいるが、点検のとき説明しづらい）')
  /* ログインだけで通す書き方が無いこと */
  const loose = S.split('\n').filter((l) =>
    /allow\s+(read|write|create|update|delete|list|get)/.test(l)
    && /request\.auth\s*!=\s*null/.test(l)
    && !/isStaff|isPortalOwner|request\.auth\.uid == uid/.test(l))
  ok(loose.length === 0, `★「ログインしていれば通す」行がある: ${loose.map((x) => x.trim()).join(' / ')}`)
}

console.log('== ② storage.rules（用紙の画像）==')
{
  const S = read('storage.rules')
  ok(/function isStaff\(\)/.test(S), '★isStaff() が無い＝ログインだけで画像が見える')
  ok(/firestore\.exists\(\/databases\/\(default\)\/documents\/staff\/\$\(request\.auth\.uid\)\)/.test(S),
    '★isStaff() が Firestore の staff/{uid} を見ていない（firestore.rules と条件がそろわない）')
  /* sheets/ の4つの操作がすべて isStaff() を通ること */
  const i = S.indexOf('match /sheets/{batchId}/{fileName}')
  ok(i > 0, 'sheets/ のブロックが無い')
  const blk = S.slice(i, S.indexOf('match /{allPaths=**}', i))
  ;[['read', '読み取り'], ['create, update', '書き込み'], ['delete', '削除']].forEach(([op, jp]) => {
    const re = new RegExp('allow ' + op.replace(/[,]/g, ',') + ':\\s*if\\s+isStaff\\(\\)')
    ok(re.test(blk), `★用紙の画像の${jp}が職員限定になっていない`)
  })
  ok(!/allow\s+\w[\w, ]*:\s*if\s+request\.auth\s*!=\s*null/.test(blk),
    '★「ログインしていれば通す」書き方が残っている')
  ok(/match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/.test(S), '他のパスの全拒否が無い')
}

console.log('== ③ recognizeSheet（文字読み取りの入口）==')
{
  const S = read('functions/index.js')
  ok(/async function requireStaff\(req, res\)/.test(S), '★職員の確認が無い＝誰でも呼べる')
  const i = S.indexOf('async function requireStaff(req, res)')
  const blk = S.slice(i, i + 2200)
  ok(/verifyIdToken/.test(blk), '★ログインが本物かを確かめていない')
  ok(/Bearer/.test(blk), 'Authorization: Bearer を読んでいない')
  ok(/doc\('staff\/' \+ decoded\.uid\)/.test(blk) || /doc\(`staff\/\$\{decoded\.uid\}`\)/.test(blk),
    '★staff/{uid} を見ていない（ログインだけで通る）')
  ok(/if \(!snap\.exists\)/.test(blk), '★staff が無い場合に断っていない')
  ok(/res\.status\(503\)/.test(blk) && /return null/.test(blk),
    '★権限を確認できなかったときに通してしまっている（確認できないなら断る）')
  ok(/sign_in_provider === 'anonymous'/.test(blk), '匿名ログインを明示的に断っていない')
  /* recognizeSheet 本体が必ず通ること */
  const j = S.indexOf('exports.recognizeSheet = onRequest')
  const body = S.slice(j, S.indexOf('exports.onSheetImageUpload', j))
  ok(/if \(!\(await requireStaff\(req, res\)\)\) return/.test(body),
    '★recognizeSheet が職員の確認を通っていない')
  /* CORS に Authorization が入っていないとブラウザから送れない */
  ok(/Access-Control-Allow-Headers[^\n]*Authorization/.test(S),
    'CORS に Authorization が無い（ブラウザから送れない）')
  /* 呼ぶ側が送っていること */
  const O = read('src/lib/ocr.js')
  ok(/currentIdToken/.test(O), '★呼ぶ側がログイン情報を送っていない＝必ず401になる')
  ok(/Authorization: 'Bearer ' \+ token/.test(O), 'Authorization の付け方が違う')
  const A = read('src/lib/auth.js')
  ok(/export async function currentIdToken\(\)/.test(A), 'currentIdToken が無い')
  ok(/getIdToken\(\)/.test(A), 'ID トークンを取っていない')
}

console.log(fail
  ? `\ncheck-rules-staff: ${pass} ok, ${fail} failed`
  : `\ncheck-rules-staff: ${pass} ok, 0 failed`)
process.exit(fail ? 1 : 0)
