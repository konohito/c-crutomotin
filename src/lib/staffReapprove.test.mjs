/* 一度解除した職員を、もう一度承認できる（2026-10-08 新設）

   ★現場報告（齊藤さんを追加できない）
     「職員を追加」で『このメールアドレスは既に登録されています。』が出て先へ進めない。

   ★なぜ起きていたか
     「解除」は staff 文書を消すだけで **Firebase のアカウントは残る**（画面の注記のとおり）。
     「追加」はアカウント作成から始めるので、既にアカウントがあると必ずそこで止まり、
     **承認に戻す道が無かった**。
     初めて使う方でも、ほかのCrutoのアプリで同じアドレスのアカウントがあれば同じことが起きる。

   ★直し方
     アカウントが既にある場合は、**入力されたパスワードで本人確認してから承認する**。
     パスワードが合えば uid が取れるので staff 文書を作れる。
     合わなければ「いまのパスワードを入れてください」と伝える（勝手に変えない）。

   ★ここで守ること
     1) 新規のときは従来どおりアカウントを作る
     2) 既にあるときは本人確認して承認する（reused を返す）
     3) パスワードが違うときは、何をすればよいか分かる文言を出す
     4) 氏名を空で送っても、前に入っていた氏名を消さない
     5) ログイン中の職員のセッションを奪わない（副アプリでやる）
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.join(DIR, 'staffAdmin.js'), 'utf8')
const UI = readFileSync(path.join(DIR, '..', 'screens', 'Staff.jsx'), 'utf8')

test('既にアカウントがあるときは、本人確認して承認する', () => {
  assert.ok(/e\.code === 'auth\/email-already-in-use'/.test(SRC),
    '既に登録されている場合を見分けていない')
  assert.ok(/authMod\.signInWithEmailAndPassword\(secAuth, email\.trim\(\), password\)/.test(SRC),
    '入力されたパスワードで本人確認していない')
  assert.ok(/reused = true/.test(SRC), '承認し直したことを返していない')
})

test('パスワードが違うときは、何をすればよいか分かる', () => {
  assert.ok(/auth\/wrong-password' \|\| e2\.code === 'auth\/invalid-credential'/.test(SRC),
    'パスワード違いを見分けていない')
  assert.ok(/いまの パスワードを入れてください|いまのパスワードを入れてください/.test(SRC),
    '何をすればよいか書いていない')
  assert.ok(/Authentication でリセット/.test(SRC), 'リセットの方法を書いていない')
})

test('新規のときは従来どおりアカウントを作る', () => {
  assert.ok(/createUserWithEmailAndPassword\(secAuth, email\.trim\(\), password\)/.test(SRC),
    'アカウント作成の経路が消えている')
})

test('氏名を空で送っても、前に入っていた氏名を消さない', () => {
  assert.ok(/\{ merge: true \}/.test(SRC), 'merge で書いていない（前の情報が消える）')
  assert.ok(/if \(name\) rec\.name = name/.test(SRC), '氏名の入れ方が変わっている')
  assert.ok(/else if \(!reused\) rec\.name = ''/.test(SRC),
    '承認し直しのときに氏名を空で上書きしている')
})

test('ログイン中の職員のセッションを奪わない', () => {
  /* 副アプリで作る／確認する。終わったら必ず片付ける。 */
  assert.ok(/initializeApp\(cfg, 'staff-admin-'/.test(SRC), '副アプリを使っていない')
  const outs = (SRC.match(/authMod\.signOut\(secAuth\)/g) || []).length
  assert.ok(outs >= 2, `副アプリからサインアウトしていない経路がある（${outs}か所。作成と確認の2か所必要）`)
  const dels = (SRC.match(/deleteApp\(sec\)/g) || []).length
  assert.ok(dels >= 3, `副アプリを片付けていない経路がある（${dels}か所）`)
})

test('画面が「追加」と「承認し直し」を言い分ける', () => {
  assert.ok(/r && r\.reused \? '既にあるアカウントを承認しました' : '職員を追加しました'/.test(UI),
    '新しく作ったのか戻したのか分からない')
})

test('戻せることが注記に書いてある', () => {
  assert.ok(/もう一度使っていただくときは/.test(UI), '戻し方が書いていない')
  assert.ok(/同じメールアドレスと、その方のいまのパスワード/.test(UI), '何を入れればよいか書いていない')
})
