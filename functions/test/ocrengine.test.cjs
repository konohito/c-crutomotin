'use strict'
/* 読み取りの engine を切り替えるところ(src/ocrengine.js)と、
   Gemini だけで読む経路(visionread.js の sheetFromVision)のテスト。

   ここで守りたいこと:
     1. 切り替えの判定は 1 か所。知らない値を入れたら既定へ倒して記録に残す
     2. **読めなかったことを 0 や空と取り違えない**（測定値は人の体力の数字）
     3. Gemini は確信度を返さないので、どの用紙も必ず職員の確認を通る
     4. 呼び出しが失敗したら空の結果を作らずに例外を投げる */
const assert = require('assert')
const Module = require('module')

/* ★資格情報なしで通すため、Vertex AI の認証だけを差し替える。
   visionread.js を読み込む**前**に仕込むこと（後からでは効かない）。
   差し替えるのはここと fetch の 2 点だけで、engine の組み立ては本物を通す。 */
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'google-auth-library') {
    return { GoogleAuth: class { async getClient() { return { async getAccessToken() { return { token: 'test' } } } } } }
  }
  return origLoad.apply(this, arguments)
}
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'test-project'
delete process.env.VISION_READ
delete process.env.OCR_ENGINE

const engine = require('../src/ocrengine')
const { sheetFromVision, parseVisionValue, parseVisionJson, VISION_CONF } = require('../src/visionread')
const { buildRecognitionFromSheet } = require('../src/recognition')
const { SHEET_COLS, VALUE_RANGE } = require('../src/mapping')

let failed = 0
const ok = (label, fn) => {
  try { fn(); console.log('✓', label) } catch (e) { console.error('✗', label, '\n ', e.message); failed++ }
}

// ---- 1) 切り替えの判定 -------------------------------------------------------
ok('既定は docai（環境変数が無ければ今までと同じ）', () => {
  assert.strictEqual(engine.DEFAULT_ENGINE, 'docai')
  assert.strictEqual(engine.resolveEngine({}, () => {}), 'docai')
})
ok('OCR_ENGINE=gemini / docai はそのまま使われ、記録は出ない', () => {
  for (const v of ['gemini', 'docai', 'GEMINI', ' Docai ']) {
    const logs = []
    const got = engine.resolveEngine({ OCR_ENGINE: v }, (m) => logs.push(m))
    assert.strictEqual(got, v.trim().toLowerCase(), `${v} → ${got}`)
    assert.deepStrictEqual(logs, [], `${v} で記録が出ている`)
  }
})
ok('知らない値・空は使わずに既定へ倒し、必ず記録に残す', () => {
  for (const v of ['', 'documentai', 'vision', 'openai', 'docai;gemini']) {
    const logs = []
    const got = engine.resolveEngine({ OCR_ENGINE: v }, (m) => logs.push(m))
    assert.strictEqual(got, 'docai', `既定へ倒れていない: "${v}" → ${got}`)
    assert.strictEqual(logs.length, 1, `記録が1件でない: "${v}"`)
    assert.ok(logs[0].includes('OCR_ENGINE'), 'どの設定かが記録に無い')
    assert.ok(logs[0].includes('docai'), '実際に使う値が記録に無い')
  }
})
ok('使える値は docai / gemini の 2 つだけ', () => {
  assert.deepStrictEqual([...engine.ENGINES], ['docai', 'gemini'])
})

// ---- 2) 測定値: 読めなかったことを 0 や空と取り違えない ----------------------
ok('parseVisionValue: null / 空 / 文字は欠測（0 にしない）', () => {
  for (const raw of [null, undefined, '', '  ', '不明', '読めません', '-', '--', 'N/A', true, false, {}, []]) {
    assert.strictEqual(parseVisionValue('weight', raw), null, `${JSON.stringify(raw)} が null でない`)
  }
})
ok('parseVisionValue: 0 は「あり得ない値」として欠測にする（体重・身長・握力）', () => {
  assert.strictEqual(parseVisionValue('weight', 0), null)
  assert.strictEqual(parseVisionValue('height', 0), null)
  assert.strictEqual(parseVisionValue('gripR', 0), null)
  assert.strictEqual(parseVisionValue('tug', 0), null)
})
ok('parseVisionValue: 片足立ちの 0 秒は実際にあり得るので採る', () => {
  assert.strictEqual(parseVisionValue('balR', 0), 0, '片足立ち 0 秒は本当の測定値')
  assert.strictEqual(parseVisionValue('balL', '0'), 0)
})
ok('parseVisionValue: 妥当範囲の外は採らない（しきい値は mapping.js の 1 つ）', () => {
  for (const cid of SHEET_COLS) {
    const [lo, hi] = VALUE_RANGE[cid]
    assert.strictEqual(parseVisionValue(cid, hi + 1), null, `${cid}: 上限超えを採っている`)
    assert.strictEqual(parseVisionValue(cid, lo - 1), null, `${cid}: 下限割れを採っている`)
    assert.strictEqual(parseVisionValue(cid, (lo + hi) / 2), (lo + hi) / 2, `${cid}: 範囲内を捨てている`)
  }
})
ok('parseVisionValue: 全角数字・全角小数点も読む', () => {
  assert.strictEqual(parseVisionValue('height', '１５２．４'), 152.4)
  assert.strictEqual(parseVisionValue('weight', '４８.６'), 48.6)
})
ok('parseVisionValue: 単位や記号が混ざった文字列は採らない（桁落ちの事故を防ぐ）', () => {
  for (const raw of ['152.4cm', '48.6 kg', '8.5秒', '1,524', '12.3.4', '約20']) {
    assert.strictEqual(parseVisionValue('height', raw), null, `${raw} を採っている`)
  }
})

// ---- 3) 応答 → 記録用紙スキーマ ---------------------------------------------
const recordJson = (over = {}) => JSON.stringify({
  type: 'record', side: null, formCode: 'R7-02', id: '12345', name: 'テスト氏名', kana: 'てすとしめい',
  answers: null,
  values: { height: 152.4, weight: 48.6, gripR: 21.3, gripL: 19.8, walk5: 4.2, walk5max: 3.1, tug: 8.5, balR: 15, balL: 12 },
  ...over,
})

ok('sheetFromVision: 読めた値だけ入り、読めない項目は value=null / conf=0', () => {
  const vis = parseVisionJson(recordJson({ values: { height: 152.4, weight: null, gripR: 'わかりません' } }))
  const sheet = sheetFromVision(vis)
  assert.strictEqual(sheet.fields.height.value, 152.4)
  assert.strictEqual(sheet.fields.height.conf, VISION_CONF)
  for (const cid of SHEET_COLS.filter(c => c !== 'height')) {
    assert.strictEqual(sheet.fields[cid].value, null, `${cid} に値が入っている`)
    assert.strictEqual(sheet.fields[cid].conf, 0, `${cid} の信頼度が 0 でない`)
  }
  // 全列が必ずある（列を飛ばすと measurements の merge で古い値が残る）
  assert.deepStrictEqual(Object.keys(sheet.fields).sort(), [...SHEET_COLS].sort())
})
ok('sheetFromVision: 氏名・かな・ID を引き継ぐ', () => {
  const sheet = sheetFromVision(parseVisionJson(recordJson()))
  assert.strictEqual(sheet.ocrName, 'テスト氏名')
  assert.strictEqual(sheet.ocrKana, 'てすとしめい')
  assert.strictEqual(sheet.ocrId, '12345')
})
ok('sheetFromVision: 氏名が読めなければ nameConf=0（高い確信度を名乗らない）', () => {
  const sheet = sheetFromVision(parseVisionJson(recordJson({ name: null })))
  assert.strictEqual(sheet.ocrName, '')
  assert.strictEqual(sheet.nameConf, 0)
})
ok('飛び込み用紙(R7-02W / R7-03W)を様式番号で判別する', () => {
  for (const [code, want] of [['R7-02W', true], ['R7-03W', true], ['R7-02', false], ['R7-03', false], [null, false]]) {
    const sheet = sheetFromVision(parseVisionJson(recordJson({ formCode: code })))
    assert.strictEqual(sheet.walkIn, want, `formCode=${code}`)
  }
})
ok('様式番号は書き方のゆれ（小文字・空白）を吸収する', () => {
  for (const code of ['r7-02w', 'R7 02 W', 'r702w']) {
    assert.strictEqual(sheetFromVision(parseVisionJson(recordJson({ formCode: code }))).walkIn, true, code)
  }
})

// ---- 4) 確信度を返さないモデルの読みは必ず職員の確認を通る -------------------
ok('Gemini の信頼度は要確認しきい値より必ず低い', () => {
  assert.ok(VISION_CONF > 0, '0 だと「読めなかった」と区別できない')
  assert.ok(VISION_CONF < 80, `要確認しきい値(80)以上になっている: ${VISION_CONF}`)
})
ok('読めた値は要確認の一覧(lowConfFields)に必ず載る', () => {
  const sheet = sheetFromVision(parseVisionJson(recordJson()))
  const rec = buildRecognitionFromSheet(sheet, { threshold: 80 })
  assert.deepStrictEqual(rec.lowConfFields.sort(), [...SHEET_COLS].sort())
  assert.strictEqual(rec.needsReview, true)
})

// ---- 5) engine を通した通し検証（Document AI を呼ばない） -------------------
/* Vertex AI の呼び出しだけを差し替えて、engine の外側の振る舞いを確かめる。
   ★実物を切り出さずにモックだけで通すと「組み立て方が変わった」事故を見落とすので、
     recognizeSheetImage（本物）をそのまま通す。差し替えるのは fetch の1点だけ。 */
/* ★ここは必ず await で包む。finally で戻すのを同期で書くと、
   本物の fetch が走ってから差し替えが外れる（実際にそれで通信してしまった）。 */
async function withFetch(handler, fn) {
  const orig = global.fetch
  global.fetch = handler
  try { return await fn() } finally { global.fetch = orig }
}
const vertexReply = (obj) => async () => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
})
const engine2 = engine

const img = Buffer.from('fake-image-bytes')
const run = (obj, opts) => withFetch(vertexReply(obj), () =>
  engine2.recognizeSheetImage({ content: img, mimeType: 'image/jpeg', meta: { no: 1, storagePath: 'sheets/b/1.jpg' } }, opts))

const tests = []
tests.push(['gemini 経路: 記録用紙の測定値が recognition に入り、要確認が立つ', async () => {
  const { rec, engine: used } = await run(JSON.parse(recordJson()), { engine: 'gemini' })
  assert.strictEqual(used, 'gemini')
  assert.strictEqual(rec.ocrEngine, 'gemini')
  assert.strictEqual(rec.fields.height.value, 152.4)
  assert.strictEqual(rec.needsReview, true)
  assert.strictEqual(rec.no, 1)
  assert.strictEqual(rec.status, 'recognized')
}])
tests.push(['gemini 経路: 要確認しきい値を下げられても職員の確認は外れない', async () => {
  /* ★ここが `rec.needsReview = true` を明示している理由。
     OCR_REVIEW_THRESHOLD を Gemini の信頼度(70)より下げると、
     信頼度による自動フラグが立たなくなり、確信度を返さないモデルの読みが
     そのまま自動判定で通ってしまう。engine 側で必ず立てて塞ぐ。 */
  const { rec } = await withFetch(vertexReply(JSON.parse(recordJson())), () =>
    engine2.recognizeSheetImage(
      { content: img, mimeType: 'image/jpeg', meta: { no: 1, storagePath: 'sheets/b/1.jpg', threshold: 60 } },
      { engine: 'gemini' }))
  assert.deepStrictEqual(rec.lowConfFields, [], 'しきい値 60 なら信頼度による要確認は立たない前提')
  assert.strictEqual(rec.needsReview, true, 'しきい値を下げたら職員の確認が外れてしまっている')
}])
tests.push(['gemini 経路: 読めない項目を 0 で埋めない', async () => {
  const { rec } = await run(JSON.parse(recordJson({ values: { height: null, weight: null, gripR: null, gripL: null, walk5: null, walk5max: null, tug: null, balR: null, balL: null } })), { engine: 'gemini' })
  for (const cid of SHEET_COLS) assert.strictEqual(rec.fields[cid].value, null, `${cid} が null でない`)
  assert.strictEqual(rec.needsReview, true)
}])
tests.push(['gemini 経路: 問診票は回答が入り、必ず要確認', async () => {
  const answers = {}
  for (let i = 14; i <= 24; i++) answers[String(i)] = i % 2 ? 'yes' : 'no'
  answers['14'] = 'yes'   // 用紙の印刷 14 → 公式 No.15
  answers.ex1 = 'yes'; answers.ex2 = 'blank'
  const { rec } = await run({ type: 'kcl', side: 'back', formCode: 'R7-03', id: '12345', name: 'テスト', answers }, { engine: 'gemini' })
  assert.ok(rec.kcl, 'kcl が無い')
  assert.strictEqual(rec.kcl.readable, true)
  assert.strictEqual(rec.kcl.via, 'vision')
  assert.strictEqual(rec.kcl.answers['15'], 'yes', '印刷 14 → 公式 15')
  assert.strictEqual(rec.kcl.answers['ex2'], null, 'blank は未回答')
  assert.strictEqual(rec.needsReview, true)
  assert.strictEqual(rec.kcl.debug.engine, 'gemini')
}])
tests.push(['gemini 経路: 判読できない設問が多い問診票は読取不可（推測しない）', async () => {
  const answers = {}
  for (let i = 14; i <= 24; i++) answers[String(i)] = 'unclear'
  answers.ex1 = 'unclear'; answers.ex2 = 'unclear'
  const { rec } = await run({ type: 'kcl', side: 'back', answers }, { engine: 'gemini' })
  assert.strictEqual(rec.kcl.readable, false)
  assert.ok(rec.kcl.reason, '理由が無い')
  assert.strictEqual(rec.needsReview, true)
}])
tests.push(['gemini 経路: 問診票なのに面が分からないときも問診票として残す', async () => {
  const { rec } = await run({ type: 'kcl', side: null, answers: { 1: 'yes' } }, { engine: 'gemini' })
  assert.ok(rec.kcl, '記録用紙として通してしまっている')
  assert.strictEqual(rec.kcl.readable, false)
  assert.ok(rec.kcl.reason.includes('面'), '理由に面のことが書かれていない')
}])
tests.push(['gemini 経路: 応答が壊れていたら例外（空の結果を作らない）', async () => {
  await assert.rejects(
    withFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'すみません読めません' }] } }] }) }),
      () => engine2.recognizeSheetImage({ content: img, mimeType: 'image/jpeg' }, { engine: 'gemini' })),
    /解釈できませんでした/)
}])
tests.push(['gemini 経路: Vertex AI がエラーなら例外（空の結果を作らない）', async () => {
  await assert.rejects(
    withFetch(async () => ({ ok: false, status: 403, text: async () => '{"error":{"message":"権限がありません"}}' }),
      () => engine2.recognizeSheetImage({ content: img, mimeType: 'image/jpeg' }, { engine: 'gemini' })),
    /403|権限/)
}])
tests.push(['gemini 経路: 画像が無ければ例外', async () => {
  await assert.rejects(() => engine2.recognizeSheetImage({ content: Buffer.alloc(0), mimeType: 'image/jpeg' }, { engine: 'gemini' }), /画像/)
  await assert.rejects(() => engine2.recognizeSheetImage({ gcsUri: 'gs://b/x.jpg' }, { engine: 'gemini' }), /gs:\/\//)
}])
tests.push(['gemini 経路: VISION_READ=0 のときは黙って通さず理由を言う', async () => {
  process.env.VISION_READ = '0'
  delete require.cache[require.resolve('../src/visionread')]
  delete require.cache[require.resolve('../src/ocrengine')]
  const e3 = require('../src/ocrengine')
  try {
    await assert.rejects(() => e3.recognizeSheetImage({ content: img, mimeType: 'image/jpeg' }, { engine: 'gemini' }), /VISION_READ/)
  } finally {
    delete process.env.VISION_READ
    delete require.cache[require.resolve('../src/visionread')]
    delete require.cache[require.resolve('../src/ocrengine')]
  }
}])
tests.push(['単票読み取り(sheetOnly): Gemini を呼ばず・問診票の読み取りもしない', async () => {
  /* ★HTTPS の recognizeSheet は 512MiB / 60 秒。以前は Document AI だけを呼んでいた。
     共通化で readKcl(画素展開 400MB) と Gemini の呼び出しが付くと落ちるので、
     sheetOnly では一切呼ばないことを固定する。 */
  process.env.DOCAI_MOCK = '1'
  delete require.cache[require.resolve('../src/visionread')]
  delete require.cache[require.resolve('../src/ocrengine')]
  const e5 = require('../src/ocrengine')
  try {
    let vertexCalls = 0
    const { sheet, rec } = await withFetch(async () => { vertexCalls++; return vertexReply({})() },
      () => e5.recognizeSheetImage({ content: img, mimeType: 'image/jpeg' }, { engine: 'docai', sheetOnly: true }))
    assert.strictEqual(vertexCalls, 0, `sheetOnly なのに Vertex AI を ${vertexCalls} 回呼んでいる`)
    assert.strictEqual(rec, null, 'sheetOnly なのに recognition を組み立てている')
    assert.ok(sheet && sheet.fields, '測定値の表が返っていない')
    assert.deepStrictEqual(Object.keys(sheet.fields).sort(), [...SHEET_COLS].sort())
  } finally { delete process.env.DOCAI_MOCK }
}])
tests.push(['知らない engine をテストから渡したら黙って倒さず断る', async () => {
  await assert.rejects(() => engine2.recognizeSheetImage({ content: img }, { engine: 'openai' }), /OCR_ENGINE/)
}])
tests.push(['docai 経路: モックの Document AI で従来どおり動く（engine を跨いで壊れていない）', async () => {
  process.env.DOCAI_MOCK = '1'
  delete require.cache[require.resolve('../src/visionread')]
  delete require.cache[require.resolve('../src/ocrengine')]
  const e4 = require('../src/ocrengine')
  try {
    // ビジョン AI の呼び出しは失敗させる（従来どおり結果は残ること）
    const { rec, engine: used } = await withFetch(async () => ({ ok: false, status: 500, text: async () => 'boom' }),
      () => e4.recognizeSheetImage({ content: img, mimeType: 'image/jpeg', meta: { no: 3, storagePath: 'sheets/b/3.jpg' } }, { engine: 'docai' }))
    assert.strictEqual(used, 'docai')
    assert.strictEqual(rec.ocrEngine, 'docai')
    assert.strictEqual(rec.no, 3)
    assert.strictEqual(rec.status, 'recognized')
    assert.ok(Object.keys(rec.fields).length === SHEET_COLS.length)
  } finally {
    delete process.env.DOCAI_MOCK
  }
}])

;(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log('✓', label) } catch (e) { console.error('✗', label, '\n ', e.message); failed++ }
  }
  Module._load = origLoad
  if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
  console.log('\nocrengine: すべて成功')
})()
