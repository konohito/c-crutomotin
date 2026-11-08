/* 測定者の古いID（st01〜st10）と氏名の対応表を Firestore に入れる（★2026-11-08 新設）
 *
 * ★なぜ要るか
 *   2026-11-08 まで、測定者の選択肢は `src/data/engine.js` に**固定で書かれた10名**だった。
 *   保存済みの予定（Firestore の events）は、その10名のID（st01〜st10）を持っている。
 *   氏名の一覧はコードから削除した（**GitHub に個人情報を載せない**）ので、
 *   そのままでは古い予定の測定者が「以前の担当者」と出る。
 *   対応表をデータベース側に置けば、今までどおり氏名で出る。
 *
 * ★なぜスクリプトにするか
 *   氏名をこのリポジトリに**1文字も書かないため**。
 *   対応表は手元のファイル（git の管理外）に書き、ここから読んで Firestore に入れる。
 *
 * ★使い方
 *   1) 手元に対応表を作る（**リポジトリの外**に置くこと。例: ~/legacy-examiners.json）
 *        { "st01": { "name": "氏名", "staffUid": "承認済み職員のUID（分かれば）" }, ... }
 *      ・name だけでよい（staffUid は分かる人だけ入れる）
 *      ・承認済み職員のUIDは「職員」の画面で足した人のIDのこと
 *   2) まず下見（**既定では何も書き込まない**）
 *        node scripts/set-legacy-examiners.mjs --file ~/legacy-examiners.json
 *   3) 内容を確かめてから、実際に書き込む（フラグ2つが必須）
 *        node scripts/set-legacy-examiners.mjs --file ~/legacy-examiners.json --write --yes
 *
 * ★書き込む先は config/legacyExaminers の map だけ。ほかは触らない。
 * ★実行には ADC（gcloud auth application-default login）が要る。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const PROJECT = 'cruto-motion'
const DOC = 'config/legacyExaminers'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : '' }

const file = val('--file')
if (!file) {
  console.log('対応表のファイルを指定してください： --file ~/legacy-examiners.json')
  console.log('（このリポジトリの中に置かないこと。GitHub に個人情報を載せないため）')
  process.exit(1)
}
const abs = path.resolve(file.replace(/^~/, process.env.HOME || '~'))
const repo = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '..'))
if (abs.startsWith(repo + path.sep)) {
  console.log('★このファイルはリポジトリの中にあります：' + abs)
  console.log('  氏名が git に入る恐れがあるため、リポジトリの外に置いてください。')
  process.exit(1)
}
if (!fs.existsSync(abs)) { console.log('ファイルがありません：' + abs); process.exit(1) }

let src
try { src = JSON.parse(fs.readFileSync(abs, 'utf8')) }
catch (e) { console.log('ファイルが読めません（JSON の形を確認してください）：' + (e && e.message)); process.exit(1) }

/* 形を確かめる。おかしい行は入れずに止める（黙って一部だけ入るのを防ぐ） */
const map = {}
const bad = []
for (const [id, v] of Object.entries(src || {})) {
  if (!/^st\d{2}$/.test(id)) { bad.push(`${id}: IDの形が違う（st01 のような2桁）`); continue }
  const name = String((v && v.name) || '').trim()
  if (!name) { bad.push(`${id}: name が空`); continue }
  const uid = String((v && v.staffUid) || '').trim()
  map[id] = uid ? { name, staffUid: uid } : { name }
}
if (bad.length) {
  console.log('★直すところがあります：')
  bad.forEach((b) => console.log('  - ' + b))
  process.exit(1)
}
const ids = Object.keys(map).sort()
console.log(`対応表: ${ids.length} 件（${ids.join(', ')}）`)
console.log(`うち 承認済み職員のUIDあり: ${ids.filter((k) => map[k].staffUid).length} 件`)
console.log('※氏名はここには出しません（画面に残らないように）')

if (!(flag('--write') && flag('--yes'))) {
  console.log('')
  console.log('下見だけで終わりました。**何も書き込んでいません。**')
  console.log('実際に入れるには --write --yes を両方つけてください。')
  process.exit(0)
}

let token
try { token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim() }
catch { console.log('ADC が取れません。gcloud auth application-default login を先に実行してください。'); process.exit(1) }
if (!token || token.length < 40) { console.log('ADC が取れません（期限切れの可能性）。'); process.exit(1) }

const fields = { map: { mapValue: { fields: {} } } }
for (const id of ids) {
  const f = { name: { stringValue: map[id].name } }
  if (map[id].staffUid) f.staffUid = { stringValue: map[id].staffUid }
  fields.map.mapValue.fields[id] = { mapValue: { fields: f } }
}
const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOC}?updateMask.fieldPaths=map`
const res = await fetch(url, {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
  body: JSON.stringify({ fields }),
})
const body = await res.text()
if (!res.ok) { console.log('書き込めませんでした（' + res.status + '）：' + body.slice(0, 300)); process.exit(1) }
console.log(`書き込みました（${DOC} の map に ${ids.length} 件）。`)
console.log('画面を開き直すと、古い予定の測定者が氏名で出ます。')
