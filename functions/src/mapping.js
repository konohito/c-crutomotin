'use strict'
/* Document AI のレスポンス(document)を記録用紙スキーマにマッピングする純粋ロジック。
   GCP 依存を持たないため単体テスト可能。フォームパーサ / カスタム抽出プロセッサの
   どちらのレスポンス形式にも対応する。 */

// engine.js の SHEET_COLS と一致させること
const SHEET_COLS = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL']

// 各測定項目の照合エイリアス(ラベル文字列 → cid)。正規化後に部分一致で判定する。
const FIELD_ALIASES = {
  walk5max: ['5m最大歩行', '最大5m', '最大歩行', '5メートル最大歩行'],
  walk5:  ['5m通常歩行', '5m歩行', '通常5m', '通常歩行', '歩行速度', '5メートル歩行'],
  balR:   ['開眼片足立ち右', '開眼片脚立位右', '片足立ち右', '片脚立位右', '片足右'],
  balL:   ['開眼片足立ち左', '開眼片脚立位左', '片足立ち左', '片脚立位左', '片足左'],
  gripR:  ['握力右', '右握力'],
  gripL:  ['握力左', '左握力'],
  tug:    ['tug', 'timedupandgo', 'タイムドアップアンドゴー'],
  height: ['身長'],
  weight: ['体重'],
}
const NAME_ALIASES = ['氏名', '名前', 'お名前', 'なまえ', 'name', 'fullname']
const KANA_ALIASES = ['ふりがな', 'フリガナ', 'かな', 'カナ', 'kana', 'furigana']
const ID_ALIASES = ['id', '参加者id', '参加者番号', '整理番号', '受付番号']

function zenToHan(s) {
  return String(s == null ? '' : s)
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, '.')
    .replace(/[　]/g, ' ')
}
// ラベル正規化: 全角→半角 → 小文字化 → 空白・記号除去
function norm(s) {
  return zenToHan(s).toLowerCase().replace(/[\s:：()（）・.,、。/／-]/g, '')
}
function matchFieldId(label) {
  const n = norm(label)
  if (!n) return null
  for (const cid of SHEET_COLS) {
    if (FIELD_ALIASES[cid].some(a => n.includes(norm(a)))) return cid
  }
  return null
}
const inAny = (label, aliases) => { const n = norm(label); return !!n && aliases.some(a => n.includes(norm(a))) }
const isName = (label) => inAny(label, NAME_ALIASES)
const isKana = (label) => inAny(label, KANA_ALIASES)
const isId = (label) => inAny(label, ID_ALIASES)

// 数値文字列 → { value, raw }。数値が読めなければ value=null(欠測扱い)。
function parseNumber(raw) {
  const s = zenToHan(raw)
  const m = s.match(/-?\d+(?:\.\d+)?/)
  return { value: m ? parseFloat(m[0]) : null, raw: String(raw == null ? '' : raw).trim() }
}
// Document AI の confidence(0-1) → パーセント(0-100)
function pct(conf) {
  const c = typeof conf === 'number' ? conf : 0
  return Math.max(0, Math.min(100, Math.round(c * 100)))
}

// textAnchor(textSegments) から document.text の該当部分を取り出す(フォームパーサ用)
function anchorText(document, anchor) {
  if (!anchor || !anchor.textSegments) return ''
  const text = document.text || ''
  return anchor.textSegments.map(seg => {
    const start = parseInt(seg.startIndex || 0, 10)
    const end = parseInt(seg.endIndex || 0, 10)
    return text.slice(start, end)
  }).join('').trim()
}

// レスポンスを (label, value, conf) のフラットな配列へ正規化する
function collectPairs(document) {
  const pairs = []
  // カスタム抽出プロセッサ: entities[].type / mentionText / confidence
  for (const e of (document.entities || [])) {
    pairs.push({ label: e.type || '', value: (e.mentionText || '').trim(), conf: pct(e.confidence) })
  }
  // フォームパーサ: pages[].formFields[].fieldName / fieldValue
  for (const page of (document.pages || [])) {
    for (const ff of (page.formFields || [])) {
      const label = anchorText(document, ff.fieldName && ff.fieldName.textAnchor)
      const value = anchorText(document, ff.fieldValue && ff.fieldValue.textAnchor)
      const vconf = ff.fieldValue && ff.fieldValue.confidence
      const nconf = ff.fieldName && ff.fieldName.confidence
      pairs.push({ label, value, conf: pct(vconf != null ? vconf : nconf) })
    }
  }
  return pairs
}

// document → { ocrName, ocrKana, ocrId, nameConf, fields:{cid:{value,raw,conf}} }
function mapDocumentToSheet(document) {
  const fields = {}
  SHEET_COLS.forEach(cid => { fields[cid] = { value: null, raw: '', conf: 0 } })
  let ocrName = '', ocrKana = '', ocrId = '', nameConf = 0

  for (const { label, value, conf } of collectPairs(document)) {
    // entities の type は cid 直か日本語ラベルのどちらもあり得る → 両対応
    const cid = SHEET_COLS.includes(label) ? label : matchFieldId(label)
    if (cid) {
      // 同一項目が複数取れた場合は信頼度が高い方を採用
      if (conf >= fields[cid].conf) {
        const parsed = parseNumber(value)
        fields[cid] = { value: parsed.value, raw: parsed.raw, conf }
      }
      continue
    }
    if (isName(label) && !ocrName) { ocrName = value; nameConf = conf }
    else if (isKana(label) && !ocrKana) { ocrKana = value }
    else if (isId(label) && !ocrId) { ocrId = value.replace(/[^\d]/g, '') }
  }
  return { ocrName, ocrKana, ocrId, nameConf, fields }
}

module.exports = {
  SHEET_COLS, FIELD_ALIASES,
  mapDocumentToSheet, collectPairs, parseNumber, matchFieldId, anchorText, norm, zenToHan,
}
