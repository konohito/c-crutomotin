'use strict'
/* ビジョン AI 読み取り(visionread)の応答解釈・キー変換・統合ロジックのテスト。
   Vertex AI の呼び出し自体はモックできない(本番で検証)ため、モデル応答を
   固定 JSON として与え、その後段がすべて仕様どおりに動くことを確かめる。 */
const assert = require('assert')
const { parseVisionJson, mapVisionAnswers, mergeKcl, kclFromVision } = require('../src/visionread')

let failed = 0
const ok = (label, fn) => {
  try { fn(); console.log('✓', label) } catch (e) { console.error('✗', label, '\n ', e.message); failed++ }
}

// ---- 応答の解釈 --------------------------------------------------------------
ok('parseVisionJson: 素の JSON を解釈', () => {
  const v = parseVisionJson('{"type":"kcl","side":"front","id":"13901","name":"テスト","answers":{"1":"yes"}}')
  assert.strictEqual(v.type, 'kcl')
  assert.strictEqual(v.id, '13901')
  assert.strictEqual(v.name, 'テスト')
})
ok('parseVisionJson: コードフェンス付きでも解釈', () => {
  const v = parseVisionJson('```json\n{"type":"record","id":"２１００５","name":null,"answers":null}\n```')
  assert.strictEqual(v.type, 'record')
  assert.strictEqual(v.id, '21005', '全角数字は半角に正規化')
})
ok('parseVisionJson: 壊れた応答は null', () => {
  assert.strictEqual(parseVisionJson('すみません、読めませんでした'), null)
})
ok('parseVisionJson: 5 桁でない ID は捨てる', () => {
  const v = parseVisionJson('{"type":"kcl","side":"back","id":"139","answers":{}}')
  assert.strictEqual(v.id, null)
})

// ---- 印刷番号 → 公式 No のキー変換 -------------------------------------------
ok('mapVisionAnswers: おもて面(印刷 12→公式 13・印刷 13→公式 14)', () => {
  const ans = {}
  for (let i = 1; i <= 13; i++) ans[String(i)] = 'yes'
  const m = mapVisionAnswers({ type: 'kcl', side: 'front', answers: ans })
  assert.strictEqual(m.answers['11'], 'yes')
  assert.strictEqual(m.answers['12'], undefined, '公式 No.12(BMI)は用紙に無い')
  assert.strictEqual(m.answers['13'], 'yes', '印刷 12 → 公式 13')
  assert.strictEqual(m.answers['14'], 'yes', '印刷 13 → 公式 14')
})
ok('mapVisionAnswers: うら面(印刷 14→公式 15・印刷 24→公式 25・ex1/ex2)', () => {
  const ans = { ex1: 'no', ex2: 'both' }
  for (let i = 14; i <= 24; i++) ans[String(i)] = i % 2 ? 'yes' : 'no'
  const m = mapVisionAnswers({ type: 'kcl', side: 'back', answers: ans })
  assert.strictEqual(m.answers['15'], 'no', '印刷 14 → 公式 15')
  assert.strictEqual(m.answers['25'], 'no', '印刷 24 → 公式 25')
  assert.strictEqual(m.answers['ex1'], 'no')
  assert.strictEqual(m.answers['ex2'], 'multi', 'both → 二重塗り')
})
ok('mapVisionAnswers: blank は null・unclear は情報なし(キーごと欠落)', () => {
  const ans = { 14: 'blank', 15: 'unclear' }
  const m = mapVisionAnswers({ type: 'kcl', side: 'back', answers: ans })
  assert.strictEqual(m.answers['15'], null, 'blank → 無回答と確信')
  assert.ok(!('16' in m.answers), 'unclear はキーを作らない')
  assert.strictEqual(m.unclear, 12, '未指定 + unclear の数')
})

// ---- 幾何ロジックとの統合 ----------------------------------------------------
const geoBase = () => ({
  side: 'front', readable: true, reason: null, via: 'markers',
  answers: { 1: 'yes', 2: 'no', 3: null, 4: 'multi' },
  debug: { src: 'text' },
})
const visFront = (ans) => ({ type: 'kcl', side: 'front', answers: ans })

ok('mergeKcl: 一致はそのまま・読めなかった設問を補完', () => {
  const merged = mergeKcl(geoBase(), visFront({ 1: 'yes', 2: 'no', 3: 'yes', 5: 'no' }))
  assert.strictEqual(merged.answers['1'], 'yes')
  assert.strictEqual(merged.answers['3'], 'yes', 'geo null → vision で補完')
  assert.strictEqual(merged.answers['5'], 'no', 'geo に無いキーも補完')
  assert.strictEqual(merged.via, 'markers+vision')
  assert.strictEqual(merged.debug.vision.filled, 2)
  assert.strictEqual(merged.debug.vision.agree, 2)
})
ok('mergeKcl: 正反対の主張は未回答(要確認)へ落とす', () => {
  const merged = mergeKcl(geoBase(), visFront({ 1: 'no' }))
  assert.strictEqual(merged.answers['1'], null, 'yes vs no → null')
  assert.strictEqual(merged.debug.vision.conflicts, 1)
})
ok('mergeKcl: blank/unclear は幾何ロジックの読みを上書きしない', () => {
  const merged = mergeKcl(geoBase(), visFront({ 1: 'blank', 2: 'unclear' }))
  assert.strictEqual(merged.answers['1'], 'yes')
  assert.strictEqual(merged.answers['2'], 'no')
})
ok('mergeKcl: 二重塗りは維持', () => {
  const merged = mergeKcl(geoBase(), visFront({ 4: 'yes' }))
  assert.strictEqual(merged.answers['4'], 'multi')
})
ok('mergeKcl: 読取不可の geo が vision で読めるようになる', () => {
  const geo = { side: 'front', readable: false, reason: 'マーカー検出できず', via: null, answers: {}, debug: null }
  const ans = {}
  for (let i = 1; i <= 13; i++) ans[String(i)] = i === 5 ? 'blank' : 'yes'
  const merged = mergeKcl(geo, visFront(ans))
  assert.strictEqual(merged.readable, true)
  assert.strictEqual(merged.reason, null)
  assert.strictEqual(merged.via, 'vision')
  assert.strictEqual(merged.answers['6'], 'yes')
  assert.strictEqual(merged.answers['5'], null, 'blank は未回答として埋める')
})
ok('mergeKcl: vision が問診票でなければ geo のまま', () => {
  const geo = geoBase()
  const merged = mergeKcl(geo, { type: 'record', side: null, answers: null })
  assert.deepStrictEqual(merged, geo)
})

// ---- 文字認識ごと失敗した写真の単独読み --------------------------------------
ok('kclFromVision: 単独で読めて via=vision', () => {
  const ans = {}
  for (let i = 14; i <= 24; i++) ans[String(i)] = 'yes'
  ans.ex1 = 'no'; ans.ex2 = 'blank'
  const kv = kclFromVision({ type: 'kcl', side: 'back', answers: ans })
  assert.strictEqual(kv.readable, true)
  assert.strictEqual(kv.via, 'vision')
  assert.strictEqual(kv.answers['15'], 'yes')
  assert.strictEqual(kv.answers['ex2'], null)
})
ok('kclFromVision: unclear が多すぎる写真は読取不可(誤読回避)', () => {
  const ans = {}
  for (let i = 14; i <= 24; i++) ans[String(i)] = 'unclear'
  ans.ex1 = 'yes'; ans.ex2 = 'yes'
  const kv = kclFromVision({ type: 'kcl', side: 'back', answers: ans })
  assert.strictEqual(kv.readable, false)
  assert.ok(kv.reason.includes('撮り直し'))
})

if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
console.log('\nvisionread: すべて成功')
