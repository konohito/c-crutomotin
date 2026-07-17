'use strict'
/* recognition.js の単体テスト(GCP 不要)。`node test/recognition.test.cjs` で実行。 */
const { parseStoragePath, buildRecognitionDoc } = require('../src/recognition')

let pass = 0, fail = 0
const check = (name, cond) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

// --- parseStoragePath ---
const p1 = parseStoragePath('sheets/batch-2025-0924-sakuragawa/12-front.jpg')
check('batchId', p1 && p1.batchId === 'batch-2025-0924-sakuragawa')
check('filename', p1 && p1.filename === '12-front.jpg')
check('no from filename', p1 && p1.no === 12)
check('non-sheets path -> null', parseStoragePath('thumbs/x.jpg') === null)
check('too short -> null', parseStoragePath('sheets/onlybatch') === null)

// --- buildRecognitionDoc ---
const document = {
  text: '',
  entities: [
    { type: '氏名', mentionText: '山田花子', confidence: 0.97 },
    { type: 'walk5', mentionText: '0.8', confidence: 0.93 },
    { type: '握力右', mentionText: '30.5', confidence: 0.6 }, // 低信頼度
    { type: '握力左', mentionText: '29.5', confidence: 0.9 },
  ],
}
const doc = buildRecognitionDoc(document, { no: 5, storagePath: 'sheets/b1/5.jpg', threshold: 80 })
check('status', doc.status === 'recognized')
check('no', doc.no === 5)
check('name', doc.ocrName === '山田花子')
check('field value', doc.fields.walk5.value === 0.8)
check('lowConf lists gripR', doc.lowConfFields.includes('gripR') && !doc.lowConfFields.includes('gripL'))
check('needsReview true', doc.needsReview === true)

// 全項目高信頼度・氏名も高信頼度 → needsReview false
const doc2 = buildRecognitionDoc({
  entities: [
    { type: '氏名', mentionText: '田中一郎', confidence: 0.95 },
    { type: 'walk5', mentionText: '0.7', confidence: 0.9 },
  ],
}, { threshold: 80 })
check('needsReview false when all high', doc2.needsReview === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
