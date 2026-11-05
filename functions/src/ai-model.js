'use strict'
/* 使う AI のモデルを決める1か所（CommonJS 版）。
 *
 * ★なぜ要るか
 *   モデル名はこれまで各ファイルに直書きだった。変えるたびにコードを直して配信し直す
 *   必要があり、しかも「どのモデルなら使ってよいのか」の判断が書いた人の頭の中にしか
 *   無かった。ここに集めて、環境変数 GEMINI_MODEL で切り替えられるようにする。
 *
 * ★モデルは自由に選べない
 *   ここへ送るのは利用者の記録なので、3省2ガイドラインの説明を成り立たせるために
 *   「東京(asia-northeast1)で呼べて、かつ公式のデータレジデンシー表で機械学習の処理が
 *   日本国内に限定されると書かれているモデル」しか使えない。
 *   環境変数で切り替えられるということは、事故で国外処理のモデルを入れられるという
 *   ことなので、許可した名前以外は**使わずに既定へ倒し、記録に残す**。
 *
 * ★表を増やすときの手順（守ること）
 *   1. 東京で実際に 200 が返ることを確かめる
 *        TOK=$(gcloud auth print-access-token)
 *        B=https://asia-northeast1-aiplatform.googleapis.com/v1/projects/<PROJECT>/locations/asia-northeast1/publishers/google/models
 *        curl -s -o /dev/null -w '%{http_code}\n' "${B}/${MODEL}:generateContent" -X POST \
 *          -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
 *          -d '{"contents":[{"role":"user","parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}'
 *      ※ zsh では波括弧で書くこと。"$B/$M:generateContent" は `:ge` を修飾子と解釈して URL を壊す。
 *   2. 公式のデータレジデンシー表で国内処理が明記されていることを確かめる
 *   3. 提供終了の予定が無いことを確かめる
 *   4. ALLOWED_MODELS に足し、FINGERPRINT を計算し直して**全リポジトリの同じ値を同時に直す**
 *
 * ★表は全リポジトリで同じもの
 *   この表は c-circuit / c-cockpit / c-terranote / c-carevoiceflow / c-Catalina /
 *   cuole-record-system / c-crutomotin の7つで同じ内容を持っている。言語が JS・TS・Python
 *   に分かれているので中身をバイト単位で揃えることはできない。そのかわり
 *   canonicalForm() で**言語に依らない1つの文字列**を作り、その SHA-256 を
 *   FINGERPRINT として全リポジトリに同じ値でコミットしてある。
 *   どれか1つを直して指紋を更新しなければ、そのリポジトリの検査が落ちる。
 */

/* ── ここからが表（全リポジトリ共通の中身） ───────────────────── */

/** 環境変数の名前。全アプリで同じものを使う。 */
const MODEL_ENV = 'GEMINI_MODEL'

/** 既定。環境変数が無ければこれまでと1ミリも変わらない。 */
const DEFAULT_MODEL = 'gemini-3.5-flash'

/** 使ってよいモデル。実測せずに足さないこと（上の手順を読む）。 */
const ALLOWED_MODELS = Object.freeze(['gemini-3.5-flash'])

/** 使えないモデル。間違えて書き戻しやすいので名指しで理由を持つ。 */
const RETIRED_MODELS = Object.freeze({
  'gemini-2.0-flash': '東京に無い（2026-09-26 実測 404）',
  'gemini-2.5-flash': '2026-10-16 に提供終了',
  'gemini-2.5-flash-lite': '東京に無い（2026-09-26 実測 404）',
  'gemini-2.5-pro': '2026-10-16 に提供終了',
  'gemini-3-flash': '東京に無い（2026-09-26 実測 404）',
  'gemini-3-pro': '東京に無い（2026-09-26 実測 404）',
  'gemini-3.5-pro': '東京に無い（2026-09-26 実測 404）',
})

/** 表の指紋。全リポジトリ・全言語で同じ値。表を直したら全部まとめて更新する。 */
const FINGERPRINT = '2e4e65b3b24b28e2d6ed421b9083870c1a10f41915cbb0de5854e52c719b9182'

/* ── 表はここまで ──────────────────────────────────────── */

/** 言語に依らない表し方。JS でも Python でも同じ文字列になること。 */
function canonicalForm() {
  return [
    'ai-models/v1',
    'default=' + DEFAULT_MODEL,
    'allow=' + [...ALLOWED_MODELS].sort().join(','),
    'deny=' + Object.keys(RETIRED_MODELS).sort().join(','),
  ].join('\n')
}

/** 使えない理由を返す。使えるときは null。 */
function reasonAgainst(name) {
  if (name === '') return '空の値'
  if (Object.prototype.hasOwnProperty.call(RETIRED_MODELS, name)) return RETIRED_MODELS[name]
  if (!ALLOWED_MODELS.includes(name)) {
    return '使ってよいモデルの表に無い名前（東京で呼べて国内処理が明記されていることを実測してから足すこと）'
  }
  return null
}

/**
 * 値から使うモデルを決める。記録には残さない純粋な判定。
 * @param {unknown} raw 環境変数の値。未設定なら undefined / null。
 * @returns {{model: string, requested: string|null, rejected: null|{requested: string, reason: string}}}
 */
function pickModel(raw) {
  if (raw === undefined || raw === null) {
    return { model: DEFAULT_MODEL, requested: null, rejected: null }
  }
  const name = String(raw).trim()
  const reason = reasonAgainst(name)
  if (reason) {
    return { model: DEFAULT_MODEL, requested: name, rejected: { requested: name, reason } }
  }
  return { model: name, requested: name, rejected: null }
}

/** 弾いたときに残す文（はっきり分かる言葉で書く）。 */
function rejectionMessage(rejected) {
  return (
    `[ai-model] ${MODEL_ENV} に指定された "${rejected.requested}" は使えないため、` +
    `既定の "${DEFAULT_MODEL}" で動かします（理由: ${rejected.reason}）。` +
    `設定を直してください。`
  )
}

/**
 * 環境変数から使うモデルを決める。弾いたときは必ず記録に残す。
 * @param {Record<string, string|undefined>} [env]
 * @param {(msg: string) => void} [log]
 */
function resolveModel(env, log) {
  const source = env || process.env
  return resolveModelFrom(source[MODEL_ENV], log)
}

/**
 * 値を直接渡して決める。環境変数の別名を見たいところ（c-circuit の GAF_MODEL）で使う。
 * @param {unknown} raw
 * @param {(msg: string) => void} [log]
 */
function resolveModelFrom(raw, log) {
  const picked = pickModel(raw)
  if (picked.rejected) (log || console.error)(rejectionMessage(picked.rejected))
  return picked.model
}

module.exports = {
  MODEL_ENV,
  DEFAULT_MODEL,
  ALLOWED_MODELS,
  RETIRED_MODELS,
  FINGERPRINT,
  canonicalForm,
  pickModel,
  rejectionMessage,
  resolveModel,
  resolveModelFrom,
}
