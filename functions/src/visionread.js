'use strict'
/* ビジョン AI(Vertex AI / Gemini)による用紙の直接読み取り。
   Document AI + 幾何ロジック(kclread)に「写真ごと理解する」第 3 の目を追加する。

   役割分担(誤読を増やさず読取率を上げるための統合方針):
   - 幾何ロジックが読めた設問 … そのまま採用。ただしビジョン AI が正反対
     (はい⇔いいえ)を主張した設問だけは未回答(要確認)に落とす
   - 幾何ロジックが読めなかった設問 … ビジョン AI がはっきり読めていれば採用
   - ID・氏名が OCR から取れなかったとき … ビジョン AI の読みで補完
   - 用紙の判別(問診票かどうか)が文字認識ごと失敗した写真 … ビジョン AI 単独で読む

   モデルは環境変数 GEMINI_MODEL で切替可能(決めるのは src/ai-model.js の 1 か所)。
   呼び出しは Cloud Functions のサービスアカウント(ADC)で行い、
   API キー等の秘密情報は不要(プロジェクトで aiplatform API の有効化が必要)。

   ── 国内リージョン(2026-09-25 ユーザー指示「motion で使用している AI はすべて国内リージョンに」)──
   ・呼び先は **asia-northeast1(東京)のリージョンエンドポイント**を URL に直書きする。
     それまで locations/global を使っており、Google 自身が「global はどのリージョンで
     処理されるか制御も把握もできない」と明記している状態だった。
     ここへ送っているのは**利用者の氏名が入った用紙の写真**なので、看過できない。
   ・2026-10-15 から 3.x 系は Durable Caching(最大24時間の保存)が既定で有効になる。
     東京に寄せておけば、その保存先も東京になる。
   ・使うモデルは **東京で呼べて、公式のデータレジデンシー表で機械学習の処理が日本国内に
     限定されると書かれているもの**だけ。どれを使ってよいかの表は src/ai-model.js が持つ。
   ★ ここにモデル名を直書きしないこと。環境変数で切り替えられるということは、事故で
     国外処理のモデルを入れられるということでもある。ai-model.js の resolveModel() が
     許可した名前以外を弾き、既定へ倒したうえで記録に残す。
   ★ 2.5 系(2.5-flash / 2.5-pro)は **2026-10-16 に提供終了済み**。もう 404 しか返さないので
     予備としての意味が無く、候補から外した(以前はここに 2.5-flash を並べていた)。 */
const { GoogleAuth } = require('google-auth-library')
const { QS } = require('./kclread')
const { SHEET_COLS, VALUE_RANGE } = require('./mapping')
const { DEFAULT_MODEL, resolveModel } = require('./ai-model')

const ENABLED = process.env.VISION_READ !== '0'
/* モデル候補(先頭から順に試し、無い/混雑なら次へ)。
   いまは許可された名前が既定の 1 つだけなので、実質 1 件になる。 */
const REGION = 'asia-northeast1'                     // ★東京。global にしない
const MODELS = [...new Set([resolveModel(), DEFAULT_MODEL])]
const MAX_BYTES = 15 * 1024 * 1024   // Vertex のインライン上限(20MB)手前で足切り
const TIMEOUT_MS = 90 * 1000

const PROMPT = `あなたは介護予防健診の紙用紙を写真から読み取る係です。写真を見て、次の JSON だけを返してください(説明文は不要)。

用紙は 2 種類あります:
A. 問診票(基本チェックリスト。左上に「様式 R7-03」または「R7-03W」)
   - おもて面:【基本チェックリスト】の見出しと設問①〜⑬。上部に記入方法の説明と「記入例」の行がある
   - うら面:【基本チェックリスト(つづき)】の設問⑭〜㉔と、【運動習慣について】の設問①②
   - 各設問の右に「はい」「いいえ」の縦長の楕円が並び、回答は楕円を黒く塗りつぶす方式
B. 体力測定 記録用紙(様式 R7-02 など。測定値を桁ごとのマスに記入する)
   - 各行は「項目名 … 前回値の印字 … 1 マス 1 桁の記入枠 … 単位」の順に並ぶ
   - 記入枠に手書きで数字が入る。枠の先頭が空欄のこともある

出力する JSON:
{
  "type": "kcl" | "record" | "other",
  "side": "front" | "back" | null,
  "formCode": "R7-02" | "R7-02W" | "R7-03" | "R7-03W" | null,
  "id": "12345" | null,
  "name": "山田花子" | null,
  "kana": "やまだはなこ" | null,
  "answers": { "1": "yes", "2": "no", ... } | null,
  "values": { "height": 152.4, "weight": 48.6, "gripR": 21.3, "gripL": 19.8,
              "walk5": 4.2, "walk5max": 3.1, "tug": 8.5, "balR": 15.0, "balL": 12.0 } | null
}

ルール:
- type: 問診票なら "kcl"、記録用紙なら "record"、どちらでもなければ "other"
- formCode: 用紙の左上に印刷されている様式番号をそのまま。読めなければ null
- id: 用紙右上の「参加者ID」欄の 5 桁の数字(印字またはシール)。読めなければ null
- name: 氏名欄の名前。( ) 内の会場名などは含めない。読めなければ null
- values は type が "record" のときのみ。キーと用紙の項目名の対応:
  height=身長(cm) / weight=体重(kg) / gripR=握力 右(kg) / gripL=握力 左(kg) /
  walk5=5m 通常歩行(秒) / walk5max=5m 最大歩行(秒) / tug=TUG(秒) /
  balR=開眼片足立ち 右(秒) / balL=開眼片足立ち 左(秒)
- values の各項目:
  ★読めた数字だけを入れる。**空欄・判読できない項目は必ず null にする。0 を入れてはいけない**
  ★「前回」と印字された欄の数字や、薄い下書きは読まない(記入枠＝行の右端の枠だけを読む)
  ★小数点は用紙に印字されている位置に従う(例: 枠が □□□.□ なら 152.4)
  ★少しでも迷う項目は null。推測で数字を作らないこと。これは人の体力の測定値です
- answers は type が "kcl" のときのみ。キーは用紙に印刷されている設問番号:
  おもて面は "1"〜"13"、うら面は "14"〜"24"。うら面の【運動習慣について】の①②は "ex1"・"ex2"
- 各設問の値:
  "yes"     = はい側の楕円が塗られている
  "no"      = いいえ側の楕円が塗られている
  "both"    = 両方塗られている
  "blank"   = どちらも塗られていない(楕円の枠線だけが見えている)
  "unclear" = 影・ボケ・見切れなどで自信を持って判定できない
- 塗りが枠からはみ出す・小さい・チェックや斜線でも、記入の意図が明らかなら yes/no と判定する
- 少しでも迷う設問は必ず "unclear" にする。推測で yes/no にしない
- おもて面の「記入例」の行は answers に含めない
- 写真が横向き・逆さでも、印刷内容から向きを判断して読む`

// ---- Vertex AI 呼び出し ------------------------------------------------------
let _auth = null
let _model = null   // 実際に使えたモデル(インスタンス内で記憶し、404 の再試行を避ける)

async function callVertex(imageBuffer, mimeType) {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
  if (!project) throw new Error('GCLOUD_PROJECT が未設定です')
  _auth = _auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const client = await _auth.getClient()
  const token = (await client.getAccessToken()).token
  const body = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBuffer.toString('base64') } },
        { text: PROMPT },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 },
  })
  const models = _model ? [_model] : MODELS
  let lastErr = null
  for (const model of models) {
    /* ★リージョンエンドポイントを URL に直書き(global を使わない)。
       ホスト名にも locations にも東京を入れる。片方だけだと global へ流れる。 */
    const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${REGION}/publishers/google/models/${model}:generateContent`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body, signal: ctl.signal,
      })
      const txt = await res.text()
      // モデルが存在しない(404)・混雑や割当超過(429)は次の候補モデルで続行する
      if (res.status === 404) { lastErr = new Error(`モデル ${model} が見つかりません`); continue }
      if (res.status === 429) { lastErr = new Error(`モデル ${model} が混雑/割当超過です`); continue }
      if (!res.ok) {
        // Vertex のエラー JSON から要点(message)だけを取り出す(権限不足・API 無効などの切り分け用)
        let msg = txt.slice(0, 300)
        try { const ej = JSON.parse(txt); if (ej.error && ej.error.message) msg = ej.error.message.slice(0, 300) } catch { /* 生テキストのまま */ }
        throw new Error(`Vertex AI ${res.status}: ${msg}`)
      }
      const data = JSON.parse(txt)
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || []
      const out = parts.map(p => p.text || '').join('')
      if (!out) throw new Error('Vertex AI の応答が空です')
      _model = model
      return { model, text: out }
    } finally { clearTimeout(timer) }
  }
  throw lastErr || new Error('利用できるモデルがありません')
}

// ---- 応答の解釈 --------------------------------------------------------------
const zen2han = (s) => String(s == null ? '' : s)
  .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[．。]/g, '.')

/* 測定値 1 項目の読み。**読めなかったことを 0 や空と取り違えないこと**が肝で、
   数字として解釈できないもの・用紙としてあり得ない値は すべて null(欠測＝要確認)にする。
   妥当範囲の表は mapping.js の 1 つだけ(VALUE_RANGE)。ここで緩めない。
   ★測定項目(SHEET_COLS)を増やすときは VALUE_RANGE にも同時に足すこと。
     範囲が無い項目は「あり得ない値」の検査を素通りする(負の数も通ってしまう)。 */
function parseVisionValue(cid, raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'boolean') return null
  const s = zen2han(raw).trim()
  if (!s) return null
  // 「不明」「読めない」等の文字が返ってきたら欠測。数字以外が混ざるものは採らない
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null
  const v = parseFloat(s)
  if (!Number.isFinite(v)) return null
  const range = VALUE_RANGE[cid]
  if (range && (v < range[0] || v > range[1])) return null   // あり得ない値は人に回す
  return v
}

// モデルの出力(JSON 文字列。コードフェンス付きのことがある)を安全に解釈する
function parseVisionJson(text) {
  let t = String(text || '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  let obj = null
  try { obj = JSON.parse(t) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const type = obj.type === 'kcl' || obj.type === 'record' ? obj.type : 'other'
  const idRaw = zen2han(obj.id).replace(/\D/g, '')
  /* 様式番号。norm と同じ要領で空白・ハイフンを落として比べられる形にする
     (飛び込み用紙 R7-02W / R7-03W の判別に使う)。 */
  const formCode = typeof obj.formCode === 'string' && obj.formCode.trim()
    ? obj.formCode.trim().toUpperCase().replace(/[\s　・.-]/g, '')
    : null
  const values = {}
  let hasValues = false
  if (obj.values && typeof obj.values === 'object') {
    for (const cid of SHEET_COLS) {
      const v = parseVisionValue(cid, obj.values[cid])
      values[cid] = v
      if (v !== null) hasValues = true
    }
  }
  return {
    type,
    side: obj.side === 'front' || obj.side === 'back' ? obj.side : null,
    formCode,
    id: /^\d{5}$/.test(idRaw) ? idRaw : null,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : null,
    kana: typeof obj.kana === 'string' && obj.kana.trim() ? obj.kana.trim() : null,
    answers: obj.answers && typeof obj.answers === 'object' ? obj.answers : null,
    values: hasValues ? values : null,
  }
}

/* ビジョン AI の読み → 記録用紙スキーマ(mapping.js の mapDocumentToSheet と同じ形)。
   Document AI を使わない経路(OCR_ENGINE=gemini)で使う。

   ★信頼度について。Gemini は項目ごとの確信度を返さない。返さないものを
     「高い」と見なすのは危険なので、**要確認しきい値(既定 80%)より必ず低い値**を入れ、
     どの項目も職員の確認を通るようにする。座標フォールバックの
     FALLBACK_MAX_CONF(75) と同じ考え方。0 にすると「読めなかった」と
     区別できなくなるため 0 にはしない。 */
const VISION_CONF = 70

function sheetFromVision(vis) {
  const fields = {}
  SHEET_COLS.forEach(cid => { fields[cid] = { value: null, raw: '', conf: 0 } })
  if (vis && vis.values) {
    for (const cid of SHEET_COLS) {
      const v = vis.values[cid]
      if (v === null || v === undefined) continue
      fields[cid] = { value: v, raw: String(v), conf: VISION_CONF }
    }
  }
  const fc = (vis && vis.formCode) || ''
  return {
    ocrName: (vis && vis.name) || '',
    ocrKana: (vis && vis.kana) || '',
    ocrId: (vis && vis.id) || '',
    nameConf: vis && vis.name ? VISION_CONF : 0,
    fields,
    walkIn: fc === 'R702W' || fc === 'R703W',
    debug: {
      engine: 'gemini',
      visionModel: (vis && vis.model) || null,
      formCode: fc || null,
      visType: (vis && vis.type) || null,
      // 読めた項目の一覧(読み取り失敗時の原因調査用。値そのものは fields にある)
      read: SHEET_COLS.filter(cid => fields[cid].value !== null),
    },
  }
}

/* 印刷の設問番号(おもて 1〜13 / うら 14〜24 / 運動習慣 ex1・ex2)を
   アプリの回答キー(公式 No。12=BMI は用紙に無い)へ引き直す。
   値は 'yes' | 'no' | 'multi' | null(blank=無回答と確信) | undefined(unclear=情報なし) */
function mapVisionAnswers(vis) {
  if (!vis || vis.type !== 'kcl' || !vis.answers || !vis.side) return null
  const val = (v) => (v === 'yes' ? 'yes' : v === 'no' ? 'no' : v === 'both' ? 'multi' : v === 'blank' ? null : undefined)
  const out = {}
  let unclear = 0, total = 0
  if (vis.side === 'front') {
    for (let i = 1; i <= 13; i++) {
      const key = String(QS[i - 1][0])
      const v = val(vis.answers[String(i)])
      total++
      if (v === undefined) unclear++
      else out[key] = v
    }
  } else {
    for (let i = 14; i <= 24; i++) {
      const key = String(QS[13 + (i - 14)][0])
      const v = val(vis.answers[String(i)])
      total++
      if (v === undefined) unclear++
      else out[key] = v
    }
    for (const ek of ['ex1', 'ex2']) {
      const v = val(vis.answers[ek])
      total++
      if (v === undefined) unclear++
      else out[ek] = v
    }
  }
  return { answers: out, unclear, total }
}

/* 幾何ロジックの読み(geo = rec.kcl の形)とビジョン AI の読みを統合する。
   - geo が読めた設問はそのまま。ただし正反対の主張は未回答(要確認)へ
   - geo が読めなかった設問は、ビジョン AI がはっきり読めていれば採用 */
function mergeKcl(geo, vis) {
  const mapped = mapVisionAnswers(vis)
  if (!mapped) return geo
  const out = { ...geo, answers: { ...(geo.answers || {}) } }
  let filled = 0, conflicts = 0, agree = 0
  for (const [k, v] of Object.entries(mapped.answers)) {
    const g = out.answers[k]
    if (g === 'yes' || g === 'no') {
      if ((v === 'yes' || v === 'no') && v !== g) { out.answers[k] = null; conflicts++ }
      else if (v === g) agree++
    } else if (g === 'multi') {
      // 二重塗りは職員確認へ(ビジョン AI では上書きしない)
    } else if (v === 'yes' || v === 'no') {
      out.answers[k] = v; filled++
    } else if (v === null && g === undefined) {
      out.answers[k] = null   // 幾何ロジックが読めず、AI が「無回答」と確信 → 未回答扱い
    }
  }
  const readN = Object.values(out.answers).filter(x => x === 'yes' || x === 'no').length
  if (!geo.readable && readN > 0) {
    out.readable = true
    out.reason = null
    out.via = 'vision'
  } else if (filled > 0 || conflicts > 0) {
    out.via = `${geo.via || 'markers'}+vision`
  }
  out.debug = { ...(geo.debug || {}), vision: { filled, conflicts, agree, unclear: mapped.unclear } }
  return out
}

// 文字認識ごと失敗した写真をビジョン AI 単独で読む(via: 'vision')
function kclFromVision(vis) {
  const mapped = mapVisionAnswers(vis)
  if (!mapped) return null
  // 判読できない設問が多すぎる写真は、誤読を避けて読取不可(撮り直し案内)へ
  if (mapped.unclear > mapped.total * 0.4) {
    return {
      side: vis.side, answers: {}, readable: false,
      reason: 'ビジョンAIでも判読できない設問が多い写真でした（用紙を平らに置き、明るい場所で真上から撮り直してください）',
      via: 'vision', debug: { vision: { unclear: mapped.unclear, total: mapped.total } },
    }
  }
  const answers = {}
  for (const [k, v] of Object.entries(mapped.answers)) answers[k] = v
  return {
    side: vis.side, answers, readable: true, reason: null, via: 'vision',
    debug: { vision: { unclear: mapped.unclear, total: mapped.total } },
  }
}

/* ビジョン AI が使えない理由。使えるときは null。
   Document AI を使わない経路では「読めなかった」と「設定で止めてある」を
   混ぜてはいけないので、理由を言葉で返せるようにしておく。 */
function visionUnavailableReason(imageBuffer) {
  if (!ENABLED) return 'ビジョン AI の読み取りが設定で止められています（VISION_READ=0）'
  if (!imageBuffer || imageBuffer.length === 0) return '画像が空です'
  if (imageBuffer.length > MAX_BYTES) return `画像が大きすぎます（上限 ${Math.round(MAX_BYTES / 1048576)}MB）`
  return null
}

// 写真 1 枚をビジョン AI で読む。失敗・無効時は null(呼び出し側は従来動作のまま)
async function readSheetVision(imageBuffer, mimeType) {
  if (visionUnavailableReason(imageBuffer)) return null
  const { model, text } = await callVertex(imageBuffer, mimeType)
  const vis = parseVisionJson(text)
  if (!vis) throw new Error('ビジョン AI の応答を解釈できませんでした: ' + String(text).slice(0, 200))
  vis.model = model
  return vis
}

module.exports = {
  readSheetVision, parseVisionJson, mapVisionAnswers, mergeKcl, kclFromVision,
  sheetFromVision, parseVisionValue, VISION_CONF, visionUnavailableReason,
}
