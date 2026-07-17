/* OCR クライアント抽象。
   VITE_OCR_ENDPOINT が設定されていれば実バックエンド(Firebase Functions + Document AI)を呼ぶ。
   未設定なら ocrEnabled()=false となり、デモは従来どおり engine のモックを使う(GitHub Pages 用)。 */
import D from '../data/engine.js'
import { dbEnabled, getIdToken } from './db.js'

export const OCR_ENDPOINT = import.meta.env.VITE_OCR_ENDPOINT || ''
export const OCR_API_KEY = import.meta.env.VITE_OCR_API_KEY || ''
export const ocrEnabled = () => !!OCR_ENDPOINT

const SHEET_COLS = ['walk5', 'balR', 'balL', 'gripR', 'gripL', 'tug', 'height', 'weight']

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''))
    r.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    r.readAsDataURL(file)
  })
}

const stripSpace = (s) => String(s || '').replace(/[\s　]/g, '')
// かな正規化(ひらがな→カタカナに寄せて比較)
const kanaKey = (s) => stripSpace(s).replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))

// OCR 結果(ocrName / ocrId / ocrKana)から台帳の利用者を照合する
export function matchUser(rec) {
  const id = String(rec.ocrId || '').replace(/[^\d]/g, '')
  if (id) { const u = D.users.find(x => x.id === id); if (u) return u }
  const name = stripSpace(rec.ocrName)
  if (name) { const u = D.users.find(x => stripSpace(x.name) === name); if (u) return u }
  const kana = kanaKey(rec.ocrKana)
  if (kana) { const u = D.users.find(x => kanaKey(x.kana) === kana); if (u) return u }
  return null
}

// 1 枚の記録用紙画像を認識 → engine の sheet と同じ形のオブジェクトを返す
export async function recognizeSheet(file, opts = {}) {
  if (!ocrEnabled()) throw new Error('OCR エンドポイントが未設定です（VITE_OCR_ENDPOINT）')
  const imageBase64 = await fileToBase64(file)
  const headers = { 'Content-Type': 'application/json', ...(OCR_API_KEY ? { 'X-Api-Key': OCR_API_KEY } : {}) }
  // 職員ログイン中は ID トークンを添付する(バックエンドの OCR_REQUIRE_AUTH=1 で検証必須にできる)
  if (dbEnabled()) {
    const token = await getIdToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ imageBase64, mimeType: file.type || 'image/jpeg' }),
  })
  let payload
  try { payload = await res.json() } catch { payload = {} }
  if (!res.ok || !payload.ok) throw new Error(payload.error || `認識に失敗しました (HTTP ${res.status})`)

  const rec = payload.sheet || {}
  const u = matchUser(rec)
  const fields = {}
  SHEET_COLS.forEach(cid => {
    const f = (rec.fields && rec.fields[cid]) || { value: null, raw: '', conf: 0 }
    fields[cid] = { value: f.value ?? null, raw: f.raw || '', conf: f.conf || 0 }
  })
  return {
    no: opts.no || 1,
    userId: u ? u.id : String(rec.ocrId || ''),
    ocrName: rec.ocrName || (u ? u.name : ''),
    ocrKana: rec.ocrKana || (u ? u.kana : ''),
    nameConf: u ? Math.max(rec.nameConf || 0, 90) : (rec.nameConf || 0),
    matched: !!u,
    matchedUser: u || null,
    fields,
    flags: [],
  }
}
