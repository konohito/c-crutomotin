'use strict'
/* mapping.js の単体テスト。GCP 依存が無いため `node test/mapping.test.cjs` で
   npm install なしに実行できる。Document AI の 2 形式(フォームパーサ / カスタム抽出)を検証。 */
const { mapDocumentToSheet, parseNumber, matchFieldId } = require('../src/mapping')

// ラベル/値ペアからフォームパーサ形式の document を組み立てる(textAnchor も正しく計算)
function buildFormParserDoc(pairs) {
  let text = ''
  const formFields = []
  for (const [label, value, conf] of pairs) {
    const ls = text.length; text += label + '\n'; const le = text.length - 1
    const vs = text.length; text += value + '\n'; const ve = text.length - 1
    formFields.push({
      fieldName: { textAnchor: { textSegments: [{ startIndex: ls, endIndex: le }] } },
      fieldValue: { textAnchor: { textSegments: [{ startIndex: vs, endIndex: ve }] }, confidence: conf },
    })
  }
  return { text, pages: [{ formFields }] }
}

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++ } else { fail++; console.error('  ✗ ' + name) }
}

// --- 1. フォームパーサ経路 ---
const doc1 = buildFormParserDoc([
  ['氏名', '山田花子', 0.98],
  ['ふりがな', 'ヤマダハナコ', 0.9],
  ['ID', '10023', 0.95],
  ['５ｍ通常歩行', '0.8', 0.93],
  ['開眼片足立ち右', '27.1', 0.88],
  ['開眼片足立ち左', '20.8', 0.6], // 低信頼度 → フロントで要確認になる
  ['握力右', '30.5', 0.91],
  ['握力左', '29.5', 0.9],
  ['TUG', '7.2', 0.94],
  ['身長', '152.3', 0.97],
  ['体重', '４８．６', 0.96], // 全角数字
])
const r1 = mapDocumentToSheet(doc1)
check('name', r1.ocrName === '山田花子')
check('kana', r1.ocrKana === 'ヤマダハナコ')
check('id', r1.ocrId === '10023')
check('nameConf %', r1.nameConf === 98)
check('walk5', r1.fields.walk5.value === 0.8 && r1.fields.walk5.conf === 93)
check('balR', r1.fields.balR.value === 27.1)
check('balL low conf', r1.fields.balL.value === 20.8 && r1.fields.balL.conf === 60)
check('gripR/L', r1.fields.gripR.value === 30.5 && r1.fields.gripL.value === 29.5)
check('tug', r1.fields.tug.value === 7.2)
check('height', r1.fields.height.value === 152.3)
check('weight zenkaku', r1.fields.weight.value === 48.6)

// --- 2. カスタム抽出プロセッサ経路(entities) ---
const doc2 = {
  text: '',
  entities: [
    { type: 'walk5', mentionText: '1.1', confidence: 0.8 },   // type が cid 直
    { type: '握力右', mentionText: '22', confidence: 0.7 },     // type が日本語ラベル
    { type: '氏名', mentionText: '田中一郎', confidence: 0.85 },
  ],
}
const r2 = mapDocumentToSheet(doc2)
check('entity walk5', r2.fields.walk5.value === 1.1)
check('entity grip alias', r2.fields.gripR.value === 22)
check('entity name', r2.ocrName === '田中一郎' && r2.nameConf === 85)
check('unset field is null/0', r2.fields.tug.value === null && r2.fields.tug.conf === 0)

// --- 3. 補助関数 ---
check('parseNumber blank -> null', parseNumber('').value === null)
check('parseNumber with unit', parseNumber('27.1 秒').value === 27.1)
check('matchFieldId zenkaku space', matchFieldId('開眼片脚立位　右') === 'balR')
check('matchFieldId weight', matchFieldId('体　重') === 'weight')
check('matchFieldId unknown -> null', matchFieldId('血圧') === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
