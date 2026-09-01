'use strict'
/* ビジョン AI(Vertex AI / Gemini)による用紙の直接読み取り。
   Document AI + 幾何ロジック(kclread)に「写真ごと理解する」第 3 の目を追加する。

   役割分担(誤読を増やさず読取率を上げるための統合方針):
   - 幾何ロジックが読めた設問 … そのまま採用。ただしビジョン AI が正反対
     (はい⇔いいえ)を主張した設問だけは未回答(要確認)に落とす
   - 幾何ロジックが読めなかった設問 … ビジョン AI がはっきり読めていれば採用
   - ID・氏名が OCR から取れなかったとき … ビジョン AI の読みで補完
   - 用紙の判別(問診票かどうか)が文字認識ごと失敗した写真 … ビジョン AI 単独で読む

   モデルは GEMINI_MODEL で切替可能(既定 gemini-2.5-pro)。見つからない場合は
   候補リストを順に試す。呼び出しは Cloud Functions のサービスアカウント(ADC)で行い、
   API キー等の秘密情報は不要(プロジェクトで aiplatform API の有効化が必要)。 */
const { GoogleAuth } = require('google-auth-library')
const { QS } = require('./kclread')

const ENABLED = process.env.VISION_READ !== '0'
const MODELS = [...new Set([process.env.GEMINI_MODEL || 'gemini-2.5-pro', 'gemini-2.5-pro', 'gemini-2.5-flash'])]
const MAX_BYTES = 15 * 1024 * 1024   // Vertex のインライン上限(20MB)手前で足切り
const TIMEOUT_MS = 90 * 1000

const PROMPT = `あなたは介護予防健診の紙用紙を写真から読み取る係です。写真を見て、次の JSON だけを返してください(説明文は不要)。

用紙は 2 種類あります:
A. 問診票(基本チェックリスト。左上に「様式 R7-03」または「R7-03W」)
   - おもて面:【基本チェックリスト】の見出しと設問①〜⑬。上部に記入方法の説明と「記入例」の行がある
   - うら面:【基本チェックリスト(つづき)】の設問⑭〜㉔と、【運動習慣について】の設問①②
   - 各設問の右に「はい」「いいえ」の縦長の楕円が並び、回答は楕円を黒く塗りつぶす方式
B. 体力測定 記録用紙(様式 R7-02 など。測定値を桁ごとのマスに記入する)

出力する JSON:
{
  "type": "kcl" | "record" | "other",
  "side": "front" | "back" | null,
  "id": "12345" | null,
  "name": "山田花子" | null,
  "kana": "やまだはなこ" | null,
  "answers": { "1": "yes", "2": "no", ... } | null
}

ルール:
- type: 問診票なら "kcl"、記録用紙なら "record"、どちらでもなければ "other"
- id: 用紙右上の「参加者ID」欄の 5 桁の数字(印字またはシール)。読めなければ null
- name: 氏名欄の名前。( ) 内の会場名などは含めない。読めなければ null
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
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body, signal: ctl.signal,
      })
      const txt = await res.text()
      if (res.status === 404) { lastErr = new Error(`モデル ${model} が見つかりません`); continue }
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
// モデルの出力(JSON 文字列。コードフェンス付きのことがある)を安全に解釈する
function parseVisionJson(text) {
  let t = String(text || '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  let obj = null
  try { obj = JSON.parse(t) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const type = obj.type === 'kcl' || obj.type === 'record' ? obj.type : 'other'
  const idRaw = String(obj.id == null ? '' : obj.id).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '')
  return {
    type,
    side: obj.side === 'front' || obj.side === 'back' ? obj.side : null,
    id: /^\d{5}$/.test(idRaw) ? idRaw : null,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : null,
    kana: typeof obj.kana === 'string' && obj.kana.trim() ? obj.kana.trim() : null,
    answers: obj.answers && typeof obj.answers === 'object' ? obj.answers : null,
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

// 写真 1 枚をビジョン AI で読む。失敗・無効時は null(呼び出し側は従来動作のまま)
async function readSheetVision(imageBuffer, mimeType) {
  if (!ENABLED) return null
  if (!imageBuffer || imageBuffer.length === 0 || imageBuffer.length > MAX_BYTES) return null
  const { model, text } = await callVertex(imageBuffer, mimeType)
  const vis = parseVisionJson(text)
  if (!vis) throw new Error('ビジョン AI の応答を解釈できませんでした: ' + String(text).slice(0, 200))
  vis.model = model
  return vis
}

module.exports = { readSheetVision, parseVisionJson, mapVisionAnswers, mergeKcl, kclFromVision }
