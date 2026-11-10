/* motion が使う AI は国内リージョンで呼ぶ（2026-09-25 ユーザー指示
   「motionで使用しているAIはすべて国内リージョンにしてください」）。

   直す前は locations/global を使っており、Google 自身が
   「global はどのリージョンで処理されるか制御も把握もできない」と明記している。
   ここへ送っているのは**利用者の氏名が入った用紙の写真**。

   ★2026-10-15 から 3.x 系は Durable Caching（最大24時間の保存）が既定で有効になる。
     東京に寄せておけば保存先も東京になる。global のままだと保存先も分からない。

   ★2026-11-05 追記。リージョンだけでなく**モデルの名前**も固定する。
     モデルは環境変数 GEMINI_MODEL で切り替えられるようにしたので、
     事故で国外処理のモデルを入れられる余地ができた。使ってよい名前の表は
     functions/src/ai-model.js が 1 つだけ持ち（全リポジトリで同じ中身・同じ指紋）、
     許可の無い名前は使わずに既定へ倒して記録に残す。ここではそれを機械的に確かめる。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const visionPath = path.join(root, 'functions/src/visionread.js')
const modelPath = path.join(root, 'functions/src/ai-model.js')
const envExamplePath = path.join(root, 'functions/.env.example')
const workflowsDir = path.join(root, '.github/workflows')

/* 「対象が無ければ素通り」にしない。読む先が1つでも欠けたらその場で落とす。 */
for (const p of [visionPath, modelPath, envExamplePath]) {
  assert.ok(fs.existsSync(p), `検査の対象が無い: ${p}`)
}

const vision = fs.readFileSync(visionPath, 'utf8')
const envExample = fs.readFileSync(envExamplePath, 'utf8')
const require_ = createRequire(import.meta.url)
const aiModel = require_(modelPath)

/** コードだけを見る（説明のコメントは判定から外す）。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('ビジョンAIは東京のリージョンエンドポイントを叩く', () => {
  assert.match(vision, /const REGION = 'asia-northeast1'/)
  // ホスト名にも locations にも東京が入っていること（片方だけだと global へ流れる）
  assert.match(vision, /https:\/\/\$\{REGION\}-aiplatform\.googleapis\.com/)
  assert.match(vision, /\/locations\/\$\{REGION\}\//)
})

test('global が残っていない（コメントでの説明は除く）', () => {
  /* 「何をやめたのか」は説明として書いてある。見るのはコードだけ。 */
  const code = stripComments(vision)
  assert.ok(!/locations\/global/.test(code), 'locations/global が残っている')
  assert.ok(!/https:\/\/aiplatform\.googleapis\.com/.test(code),
    'リージョン名の付かない aiplatform ホストが残っている（= global）')
})

test('preview のモデルを本番の既定にしていない', () => {
  const code = stripComments(vision)
  assert.ok(!/preview/.test(code), 'preview 版が残っている（提供保証が無い）')
})

test('なぜ東京にしたかが書いてある', () => {
  assert.match(vision, /国内リージョン/)
  assert.match(vision, /global/)   // 何をやめたのかが分かる
})

// ---- 使ってよいモデルの表 ----------------------------------------------------

test('表の指紋が全リポジトリ共通の値と一致する', () => {
  /* 7リポジトリが同じ表を持っている。どれか1つを直して指紋を更新しなければ落ちる。 */
  const EXPECTED = '2e4e65b3b24b28e2d6ed421b9083870c1a10f41915cbb0de5854e52c719b9182'
  assert.equal(aiModel.FINGERPRINT, EXPECTED, 'ai-model.js の FINGERPRINT が共通の値と違う')
  const actual = createHash('sha256').update(aiModel.canonicalForm()).digest('hex')
  assert.equal(actual, EXPECTED, '表の中身を変えたのに FINGERPRINT を更新していない')
})

test('環境変数の名前と既定は全アプリ共通のもの', () => {
  assert.equal(aiModel.MODEL_ENV, 'GEMINI_MODEL')
  assert.equal(aiModel.DEFAULT_MODEL, 'gemini-3.5-flash')
  assert.ok(aiModel.ALLOWED_MODELS.includes(aiModel.DEFAULT_MODEL), '既定が許可の表に無い')
})

test('許可されているのは東京で呼べて国内処理が明記されているものだけ', () => {
  /* 増やすときは、実際に東京で 200 が返ることと、公式のデータレジデンシー表に
     国内処理と書かれていることを確かめてから ai-model.js の表に足すこと。 */
  const TOKYO_OK = new Set(aiModel.ALLOWED_MODELS)
  assert.ok(TOKYO_OK.size > 0, '許可の表が空')
  for (const name of TOKYO_OK) {
    assert.ok(!/preview|exp/.test(name), `提供保証の無い名前が許可に入っている: ${name}`)
    assert.ok(!Object.prototype.hasOwnProperty.call(aiModel.RETIRED_MODELS, name),
      `使えない表にも載っている名前が許可に入っている: ${name}`)
  }
  // 提供終了したものが許可に混ざっていないこと（名指しで固定する）
  for (const name of ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-pro']) {
    assert.ok(!TOKYO_OK.has(name), `使えないモデルが許可に入っている: ${name}`)
  }
})

// ---- 呼び出し側（visionread.js） ---------------------------------------------

test('visionread はモデル名を直書きせず resolveModel で決める', () => {
  const code = stripComments(vision)
  const hits = code.match(/gemini-[a-z0-9.\-]+/g) || []
  assert.deepEqual(hits, [], `visionread.js にモデル名の直書きが残っている: ${hits.join(' / ')}`)
  assert.match(code, /require\('\.\/ai-model'\)/, 'ai-model を読み込んでいない')
  assert.match(code, /resolveModel/, 'resolveModel を使っていない')
  assert.match(code, /const MODELS = \[\.\.\.new Set\(\[/, 'MODELS の組み立て方が変わっている')
})

test('実際に組み立てられる候補は許可された名前だけ', () => {
  /* visionread.js は画像ライブラリを読み込むので、フロント側の検査からは読み込めない
     （functions/node_modules を入れていない）。かわりに MODELS の式を取り出して、
     そこに現れる値を実際に評価し、出てくる名前が許可の表に収まることを確かめる。 */
  const code = stripComments(vision)
  const m = /const MODELS = \[\.\.\.new Set\(\[([\s\S]*?)\]\)\]/.exec(code)
  assert.ok(m, 'MODELS を読み取れない')
  const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean)
  assert.deepEqual(parts, ['resolveModel()', 'DEFAULT_MODEL'],
    `MODELS に許可の表を通らない値が入っている: ${parts.join(' / ')}`)

  const built = [...new Set([aiModel.resolveModel({}, () => {}), aiModel.DEFAULT_MODEL])]
  assert.deepEqual(built, ['gemini-3.5-flash'], '環境変数が無いときの候補が変わっている')
  for (const raw of ['gemini-2.5-pro', 'gemini-2.5-flash', '', 'でたらめ']) {
    const b = [...new Set([aiModel.resolveModel({ GEMINI_MODEL: raw }, () => {}), aiModel.DEFAULT_MODEL])]
    for (const x of b) assert.ok(aiModel.ALLOWED_MODELS.includes(x), `候補に許可外が混ざる: ${x}`)
  }
})

// ---- 振る舞い（環境変数で何が起きるか） --------------------------------------

test('環境変数が無いときは、いままでと同じ gemini-3.5-flash', () => {
  const lines = []
  assert.equal(aiModel.resolveModel({}, (m) => lines.push(m)), 'gemini-3.5-flash')
  assert.deepEqual(lines, [], '何も弾いていないのに記録が出ている')
})

test('許可の無い名前は使わずに既定へ倒し、必ず記録に残る', () => {
  const cases = ['gemini-2.5-pro', 'gemini-3.5-pro', 'gemini-2.5-flash', '', 'でたらめな名前', 'gpt-4o']
  for (const raw of cases) {
    const lines = []
    const got = aiModel.resolveModel({ GEMINI_MODEL: raw }, (m) => lines.push(m))
    assert.equal(got, 'gemini-3.5-flash', `既定へ倒れていない: "${raw}" → ${got}`)
    assert.equal(lines.length, 1, `記録が1件でない: "${raw}" → ${lines.length}件`)
    assert.match(lines[0], /GEMINI_MODEL/, `記録にどの設定か書かれていない: "${raw}"`)
    assert.match(lines[0], /gemini-3\.5-flash/, `記録に実際に使う名前が書かれていない: "${raw}"`)
  }
})

test('許可された名前はそのまま使われ、記録は出ない', () => {
  for (const raw of aiModel.ALLOWED_MODELS) {
    const lines = []
    assert.equal(aiModel.resolveModel({ GEMINI_MODEL: raw }, (m) => lines.push(m)), raw)
    assert.deepEqual(lines, [], `許可された名前なのに記録が出ている: ${raw}`)
  }
})

// ---- 設定ファイルと配信の手順 ------------------------------------------------

test('.env.example に提供終了したモデルが書かれていない', () => {
  const m = /^GEMINI_MODEL=(.*)$/m.exec(envExample)
  assert.ok(m, '.env.example に GEMINI_MODEL の行が無い')
  const value = m[1].trim()
  assert.ok(value === '' || aiModel.ALLOWED_MODELS.includes(value),
    `.env.example の GEMINI_MODEL が許可の表に無い: "${value}"`)
  // 「ここに書いてよいモデル」が読んだ人に分かること
  assert.match(envExample, /書いてよい/, '書いてよいモデルの説明が無い')
})

test('配信で空の GEMINI_MODEL を書き込む道が無い', () => {
  /* Repository Variables に GEMINI_MODEL は設定されていない（2026-11-05 実測）。
     `GEMINI_MODEL=${{ vars.GEMINI_MODEL || '' }}` のように直に展開すると
     .env に空行が書かれ、resolveModel が毎回「空の値」として弾いて記録が溢れる。
     設定されているときだけ行を足す形にすること。 */
  assert.ok(fs.existsSync(workflowsDir), '.github/workflows が無い')
  const files = fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))
  assert.ok(files.length > 0, 'ワークフローが1つも無い')
  let wrote = 0
  for (const f of files) {
    const y = fs.readFileSync(path.join(workflowsDir, f), 'utf8')
    assert.ok(!/GEMINI_MODEL=\$\{\{/.test(y),
      `${f}: GEMINI_MODEL を .env へ直に展開している（未設定だと空行になる）`)
    if (/GEMINI_MODEL=/.test(y)) {
      wrote++
      assert.match(y, /if \[ -n "\$MODEL_VAR" \]/,
        `${f}: GEMINI_MODEL を書くのに、設定されているかの判定が無い`)
    }
  }
  assert.equal(wrote, 1, `GEMINI_MODEL を .env に書くワークフローは1本のはず（実際 ${wrote} 本）`)
})

test('Document AI のリージョン設定がどこにあるか分かる', () => {
  /* Document AI は日本リージョンが存在しない（us / eu / ムンバイ / シンガポール等のみ）。
     ここは設定で切り替える作りなので、値そのものは検査しない。
     「切り替えられる場所がある」ことだけ固定し、判断はユーザーに残す。 */
  const cfg = fs.readFileSync(path.join(root, 'functions/src/config.js'), 'utf8')
  assert.match(cfg, /DOCAI_LOCATION/)
  assert.match(cfg, /Document AI のロケーション/)
})

// ---- 読み取りの engine（2026-11-10 ユーザー確定） ----------------------------
/* Document AI を使わない経路（東京の Gemini だけで読む）を足した。
   ★3省2ガイドラインの説明が engine で変わる（docai は読み取りの瞬間だけ米国へ出る／
     gemini は国外へ出る経路が無い）ので、**判定が 1 か所であること**を機械で固定する。
     2 か所に書くと「どちらで読んでいるか」を誰も答えられなくなる。 */
const enginePath = path.join(root, 'functions/src/ocrengine.js')
assert.ok(fs.existsSync(enginePath), `検査の対象が無い: ${enginePath}`)
const engineSrc = fs.readFileSync(enginePath, 'utf8')
/* ★ここは read するだけで require しない。
   ocrengine.js は画像ライブラリ(jpeg-js / pngjs)まで辿るので、
   functions/node_modules を入れていないフロント側の検査からは読み込めない
   （CI は `npm run check` → そのあと functions の npm ci の順で走る）。
   振る舞いの検証は functions/test/ocrengine.test.cjs が受け持つ。 */
const engineCode = stripComments(engineSrc)

test('engine の既定は docai（設定しなければ今までと同じ）', () => {
  assert.match(engineCode, /const DEFAULT_ENGINE = 'docai'/, '既定が docai でない')
  assert.match(engineCode, /const ENGINE_ENV = 'OCR_ENGINE'/, '環境変数の名前が変わっている')
})

test('使える engine は docai / gemini だけ', () => {
  const m = /const ENGINES = Object\.freeze\(\[([^\]]*)\]\)/.exec(engineCode)
  assert.ok(m, 'ENGINES を読み取れない')
  const names = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual(names, ['docai', 'gemini'], `使える engine が変わっている: ${names.join(' / ')}`)
})

test('知らない engine は使わずに既定へ倒し、記録に残す作りになっている', () => {
  // 表に無い名前をそのまま使う道が無いこと（pickEngine が ENGINES を通す）
  assert.match(engineCode, /ENGINES\.includes\(name\)/, 'ENGINES で絞っていない')
  assert.match(engineCode, /engine: DEFAULT_ENGINE/, '弾いたときに既定へ倒していない')
  /* 弾いたら必ず記録に残ること。
     ★`if (picked.rejected)` があるだけでは不十分（中身を void にされても通ってしまう。
       わざと壊す検査で実際に見逃した）。**ログを呼ぶ式そのもの**を固定する。 */
  assert.match(engineCode, /if \(picked\.rejected\)\s*\(log \|\| console\.error\)\(rejectionMessage\(picked\.rejected\)\)/,
    '弾いたときにログを呼んでいない（判定だけ残して中身を消していないか）')
  assert.match(engineSrc, /rejectionMessage/, '弾いた理由の文が無い')
})

test('engine の判定は 1 か所だけ（他のファイルに分岐を書かない）', () => {
  /* OCR_ENGINE を読むのは ocrengine.js だけであること。
     index.js など呼び出し側に分岐が増えると、判定が二重になって必ず食い違う。 */
  const files = ['functions/index.js', 'functions/src/config.js', 'functions/src/visionread.js',
    'functions/src/documentai.js', 'functions/src/mapping.js', 'functions/src/kclread.js',
    'functions/src/recognition.js']
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(root, f), 'utf8'))
    assert.ok(!/OCR_ENGINE/.test(code), `${f} が OCR_ENGINE を読んでいる（判定は ocrengine.js の1か所に）`)
  }
  // ocrengine.js 自身も process.env を見るのは resolveEngine の 1 本だけ
  const hits = (stripComments(engineSrc).match(/process\.env/g) || []).length
  assert.equal(hits, 1, `ocrengine.js が process.env を ${hits} か所で読んでいる（1 か所にすること）`)
})

test('gemini 経路は確信度を名乗らず、必ず職員の確認を通す', () => {
  /* Gemini は項目ごとの確信度を返さない。返さないものを「高い」と見なすと
     測定値が自動判定で通ってしまう。要確認しきい値より必ず低い値を入れること。 */
  const visionSrc = fs.readFileSync(visionPath, 'utf8')
  const m = /const VISION_CONF = (\d+)/.exec(stripComments(visionSrc))
  assert.ok(m, 'visionread.js に VISION_CONF が無い')
  const conf = Number(m[1])
  assert.ok(conf > 0, 'VISION_CONF が 0（読めなかったのと区別できない）')
  assert.ok(conf < 80, `VISION_CONF が要確認しきい値(80)以上: ${conf}`)
  /* しきい値をどう動かしても要確認が外れないよう、gemini 経路で必ず立てていること。
     ★ファイル全体に `rec.needsReview = true` があるかを見るだけでは不十分
       （docai 経路にも同じ行があるので、gemini 側だけ消されても通ってしまう。
         わざと壊す検査で実際に見逃した）。**gemini の関数の中**を見る。 */
  const body = /async function recognizeByGemini\([\s\S]*?\n\}/.exec(engineCode)
  assert.ok(body, 'recognizeByGemini が見つからない')
  assert.match(body[0], /rec\.needsReview = true/,
    'gemini 経路で needsReview を立てていない（確信度を返さないモデルの読みが自動判定で通る）')
})

test('配信で空の OCR_ENGINE を書き込む道が無い', () => {
  /* GEMINI_MODEL と同じ事故（空文字を書くと毎回弾かれてログが溢れる）を防ぐ。 */
  const files = fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))
  let wrote = 0
  for (const f of files) {
    const y = fs.readFileSync(path.join(workflowsDir, f), 'utf8')
    assert.ok(!/OCR_ENGINE=\$\{\{/.test(y),
      `${f}: OCR_ENGINE を .env へ直に展開している（未設定だと空行になる）`)
    if (/OCR_ENGINE=/.test(y)) {
      wrote++
      assert.match(y, /if \[ -n "\$ENGINE_VAR" \]/,
        `${f}: OCR_ENGINE を書くのに、設定されているかの判定が無い`)
    }
  }
  assert.ok(wrote >= 1, 'OCR_ENGINE を .env に書くワークフローが無い（設定しても効かない）')
})
