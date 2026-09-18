'use strict'
/* ビジョン AI の読み → 記録用紙スキーマ(sheetFromVision)のテスト。
   Document AI をやめて Gemini(東京)単独で読む経路の要。
   measure の誤読が台帳に入らないこと(妥当範囲での足切り)を重点的に見る。 */
const assert = require('assert')
const { sheetFromVision, parseVisionValue, isWalkInForm } = require('../src/visionsheet')
const { buildRecognitionFromSheet } = require('../src/recognition')
const { SHEET_COLS } = require('../src/mapping')

let failed = 0
const ok = (label, fn) => {
  try { fn(); console.log('✓', label) } catch (e) { console.error('✗', label, '\n ', e.message); failed++ }
}

// ---- 1 項目の解釈 ------------------------------------------------------------
ok('parseVisionValue: 妥当な値はそのまま採用', () => {
  const p = parseVisionValue('163.2', 'height')
  assert.strictEqual(p.value, 163.2)
  assert.strictEqual(p.state, 'ok')
  assert.ok(p.conf >= 80, '要確認しきい値(80)を超える')
})
ok('parseVisionValue: 全角数字も読む', () => {
  assert.strictEqual(parseVisionValue('１６３．２', 'height').value, 163.2)
})
ok('parseVisionValue: null は空欄(未測定)', () => {
  const p = parseVisionValue(null, 'weight')
  assert.strictEqual(p.value, null)
  assert.strictEqual(p.state, 'blank')
  assert.strictEqual(p.conf, 0)
})
ok('parseVisionValue: unclear は値を作らない', () => {
  const p = parseVisionValue('unclear', 'weight')
  assert.strictEqual(p.value, null)
  assert.strictEqual(p.state, 'unclear')
})
/* 1 マス 1 桁の記入枠は先頭が空欄になることがあり、小数点を読み落とすと
   「50.4」が「504」になる。桁が 10 倍ずれた値を台帳に入れない。 */
ok('parseVisionValue: 小数点の取り違え(体重 504)は採用しない', () => {
  const p = parseVisionValue('504', 'weight')
  assert.strictEqual(p.value, null, '範囲外の値は採用しない')
  assert.strictEqual(p.raw, '504', '生の読みは職員に見せるため残す')
  assert.ok(p.conf > 0 && p.conf < 80, '要確認として目立たせる')
})
ok('parseVisionValue: 身長 16.3(小数点が 1 桁ずれ)も採用しない', () => {
  assert.strictEqual(parseVisionValue('16.3', 'height').value, null)
})
ok('parseVisionValue: 範囲の端は採用する', () => {
  assert.strictEqual(parseVisionValue('100', 'height').value, 100)
  assert.strictEqual(parseVisionValue('210', 'height').value, 210)
})
ok('parseVisionValue: 数字でない応答は unclear 扱い', () => {
  assert.strictEqual(parseVisionValue('読めません', 'tug').value, null)
})

// ---- 様式番号 ----------------------------------------------------------------
ok('isWalkInForm: R7-02W / R7-03W は飛び込み用紙', () => {
  assert.strictEqual(isWalkInForm('R702W'), true)
  assert.strictEqual(isWalkInForm('R7-03W'), true)
  assert.strictEqual(isWalkInForm('R7-02'), false)
  assert.strictEqual(isWalkInForm(null), false)
})

// ---- シート全体 --------------------------------------------------------------
ok('sheetFromVision: 9 項目そろった読みを記録用紙スキーマにする', () => {
  const vis = {
    type: 'record', form: 'R702', id: '13901', name: '山下 芳代', kana: 'ヤマシタ ヨシヨ',
    values: {
      height: '152.4', weight: '48.6', gripR: '22.1', gripL: '20.8',
      walk5: '4.2', walk5max: '3.6', tug: '9.4', balR: '31.0', balL: '28.5',
    },
    model: 'gemini-test',
  }
  const s = sheetFromVision(vis)
  assert.strictEqual(s.ocrName, '山下 芳代')
  assert.strictEqual(s.ocrId, '13901')
  assert.strictEqual(s.walkIn, false)
  for (const cid of SHEET_COLS) assert.ok(s.fields[cid].value !== null, `${cid} が読めていない`)
  assert.strictEqual(s.debug.source, 'vision')
  assert.strictEqual(s.debug.model, 'gemini-test')
})
ok('sheetFromVision: values が無くても 9 項目の枠は必ず作る', () => {
  const s = sheetFromVision({ type: 'kcl', side: 'front', answers: {} })
  assert.deepStrictEqual(Object.keys(s.fields).sort(), SHEET_COLS.slice().sort())
  for (const cid of SHEET_COLS) assert.strictEqual(s.fields[cid].value, null)
  assert.strictEqual(s.debug.states.height, 'missing', '応答に無い項目は missing(空欄と区別)')
})
ok('sheetFromVision: 飛び込み用紙は walkIn が立つ', () => {
  assert.strictEqual(sheetFromVision({ type: 'record', form: 'R702W', values: {} }).walkIn, true)
})
ok('sheetFromVision: ID は数字以外を落とす', () => {
  assert.strictEqual(sheetFromVision({ type: 'record', id: 'No.13901', values: {} }).ocrId, '13901')
})

// ---- 認識ドキュメントまで通す -------------------------------------------------
ok('buildRecognitionFromSheet: 範囲外の項目が要確認に挙がる', () => {
  const s = sheetFromVision({
    type: 'record', form: 'R702', id: '13901', name: 'テスト',
    values: { height: '152.4', weight: '504', gripR: 'unclear' },
  })
  const rec = buildRecognitionFromSheet(s, { no: 3, storagePath: 'sheets/b/3.jpg', threshold: 80 })
  assert.strictEqual(rec.status, 'recognized')
  assert.deepStrictEqual(rec.lowConfFields, ['weight'])
  assert.strictEqual(rec.needsReview, true)
  assert.strictEqual(rec.fields.height.value, 152.4)
  assert.strictEqual(rec.fields.weight.value, null)
})

if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
console.log('\nvisionsheet: すべて成功')
