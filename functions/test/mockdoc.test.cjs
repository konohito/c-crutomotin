'use strict'
/* mockdoc(エミュレータ/CI 用の合成 Document AI レスポンス)の単体テスト。 */
const assert = require('assert')
const { mockDocument } = require('../src/mockdoc')
const { mapDocumentToSheet } = require('../src/mapping')
const { buildRecognitionDoc } = require('../src/recognition')

let pass = 0, fail = 0
const check = (label, cond) => { if (cond) { pass++ } else { fail++; console.error('  ✗', label) } }

const FIELDS = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL']

// 1) 決定論: 同じ入力は同じ結果
const a = mockDocument('gs://demo/sheets/b/1-x.jpg')
const b = mockDocument('gs://demo/sheets/b/1-x.jpg')
check('決定論的(同入力→同出力)', JSON.stringify(a) === JSON.stringify(b))

// 2) 異なる入力は異なる結果(値のばらつき)
const c = mockDocument('gs://demo/sheets/b/2-x.jpg')
check('入力が違えば結果も変わる', JSON.stringify(a) !== JSON.stringify(c))

// 3) mapping を通すと 9 項目すべて値が入る
const sheet = mapDocumentToSheet(a)
check('氏名あり', !!sheet.ocrName)
check('ふりがなあり', !!sheet.ocrKana)
check('参加者IDあり(数字)', /^\d+$/.test(sheet.ocrId))
FIELDS.forEach(f => check(`${f} に値`, sheet.fields[f] && sheet.fields[f].value != null))

// 4) recognition ドキュメント: 低信頼度が 1 件 → 要確認
const rec = buildRecognitionDoc(a, { no: 1, storagePath: 'sheets/b/1-x.jpg', threshold: 80 })
check('status=recognized', rec.status === 'recognized')
check('低信頼度が1件検出', rec.lowConfFields.length === 1)
check('needsReview=true', rec.needsReview === true)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
