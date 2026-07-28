'use strict'
/* mapping.js の単体テスト。GCP 依存が無いため `node test/mapping.test.cjs` で
   npm install なしに実行できる。Document AI の 2 形式(フォームパーサ / カスタム抽出)を検証。 */
const { mapDocumentToSheet, parseNumber, matchFieldId, digitsToValue } = require('../src/mapping')

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

// --- 3. 空間フォールバック(ペアリング失敗時にトークン座標から記入枠を拾う) ---
// 実際の記録用紙のレイアウトを模した座標付き document を組み立てる
function geoDoc({ pairs = [], lines = [], tokens = [] }) {
  let text = ''
  const seg = (s) => { const st = text.length; text += s + '\n'; return [{ startIndex: st, endIndex: st + s.length }] }
  const formFields = pairs.map(([label, value, conf]) => ({
    fieldName: { textAnchor: { textSegments: seg(label) } },
    fieldValue: { textAnchor: { textSegments: seg(value) }, confidence: conf },
  }))
  const mk = ({ t, x, y, conf }) => ({ layout: {
    textAnchor: { textSegments: seg(t) },
    confidence: conf,
    boundingPoly: { normalizedVertices: [
      { x: x - 0.01, y: y - 0.008 }, { x: x + 0.01, y: y - 0.008 },
      { x: x + 0.01, y: y + 0.008 }, { x: x - 0.01, y: y + 0.008 },
    ] },
  } })
  const pageLines = lines.map(mk)
  const pageTokens = tokens.map(mk)
  return { text, pages: [{ formFields, lines: pageLines, tokens: pageTokens }] }
}

// 行 y: 身長 0.30 〜 開眼左 0.70(ピッチ 0.05)。写真の傾きを模して右側(x>=0.44)は y+0.03。
const ROWS = { height: 0.30, weight: 0.35, gripR: 0.40, gripL: 0.45, walk5: 0.50, walk5max: 0.55, tug: 0.60, balR: 0.65, balL: 0.70 }
const LABELS = { height: '身長', weight: '体重', gripR: '握力右', gripL: '握力左', walk5: '5m通常歩行', walk5max: '5m最大歩行', tug: 'TUG', balR: '開眼片足立ち右', balL: '開眼片足立ち左' }
const UNITS = { height: 'cm', weight: 'kg', gripR: 'kg', gripL: 'kg', walk5: '秒', walk5max: '秒', tug: '秒', balR: '秒', balL: '秒' }
const tilt = (x, y) => (x >= 0.44 ? y + 0.03 : y)
const lines3 = Object.keys(ROWS).map(cid => ({ t: LABELS[cid], x: 0.19, y: ROWS[cid] }))
const tokens3 = []
Object.keys(ROWS).forEach(cid => tokens3.push({ t: UNITS[cid], x: 0.85, y: tilt(0.85, ROWS[cid]) }))
const boxRow = (cid, chars) => chars.forEach((ch, i) => {
  const x = 0.62 + i * 0.04
  tokens3.push({ t: ch, x, y: tilt(x, ROWS[cid]), conf: 0.85 })
})
boxRow('height', ['1', '5', '4', '.', '3'])
boxRow('weight', ['4', '8', '.', '2'])
// gripR: 記入枠は空欄。印字の前回値「前回 24.0」だけがある(拾ってはいけない)
tokens3.push({ t: '前回', x: 0.44, y: tilt(0.44, ROWS.gripR) })
tokens3.push({ t: '24.0', x: 0.50, y: tilt(0.50, ROWS.gripR), conf: 0.9 })
// gripL: 下書き(①②)の手書き 18 が左にあるが、最も右のクラスタ=記入枠を採用する
tokens3.push({ t: '18', x: 0.30, y: tilt(0.30, ROWS.gripL), conf: 0.8 })
boxRow('gripL', ['1', '9', '.', '0'])
boxRow('walk5', ['2', '9'])            // 小数点が読めていない → 枠構成 [1,1] から 2.9 に補完
boxRow('tug', ['8', '8', '2'])         // 同上 [2,1] → 88.2
boxRow('balR', ['6', '0', '.', '0'])
boxRow('balL', ['５', '２', '．', '５']) // 全角
// walk5max: 未実施(トークンなし)

const doc3 = geoDoc({
  pairs: [
    ['氏名', 'テスト', 0.9],
    ['参加者ID', '13901', 0.95],
    ['身長', '初回', 0.9], // 誤ペアリング(値が「初回」) → 数値 null → フォールバックが補完する
  ],
  lines: lines3,
  tokens: tokens3,
})
const r3 = mapDocumentToSheet(doc3)
check('fb name/id via pairs', r3.ocrName === 'テスト' && r3.ocrId === '13901')
check('fb height (misspair -> boxes)', r3.fields.height.value === 154.3)
check('fb height conf capped', r3.fields.height.conf > 0 && r3.fields.height.conf <= 75)
check('fb weight', r3.fields.weight.value === 48.2)
check('fb gripR prev excluded -> null', r3.fields.gripR.value === null)
check('fb gripL rightmost cluster', r3.fields.gripL.value === 19.0)
check('fb walk5 decimal from box def', r3.fields.walk5.value === 2.9)
check('fb tug decimal from box def', r3.fields.tug.value === 88.2)
check('fb balR', r3.fields.balR.value === 60)
check('fb balL zenkaku', r3.fields.balL.value === 52.5)
check('fb walk5max stays null', r3.fields.walk5max.value === null)
check('fb debug lists filled cids', Array.isArray(r3.debug.fallback) && r3.debug.fallback.includes('height') && !r3.debug.fallback.includes('gripR'))
check('fb debug pairs recorded', Array.isArray(r3.debug.pairs) && r3.debug.pairs.length === 3)

// --- 4. 補助関数 ---
check('digitsToValue with dot', digitsToValue('154.3', [3, 1]) === 154.3)
check('digitsToValue insert dot', digitsToValue('240', [2, 1]) === 24.0)
check('digitsToValue int only', digitsToValue('24', [2, 1]) === 24)
check('digitsToValue too long -> null', digitsToValue('12345', [2, 1]) === null)
check('digitsToValue empty -> null', digitsToValue('', [2, 1]) === null)

// --- 5. 補助関数(既存) ---
check('parseNumber blank -> null', parseNumber('').value === null)
check('parseNumber with unit', parseNumber('27.1 秒').value === 27.1)
check('matchFieldId zenkaku space', matchFieldId('開眼片脚立位　右') === 'balR')
check('matchFieldId weight', matchFieldId('体　重') === 'weight')
check('matchFieldId unknown -> null', matchFieldId('血圧') === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
