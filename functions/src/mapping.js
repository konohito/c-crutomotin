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
  gripR:  ['握力右', '右握力', '握カ右'], // 「力」はカタカナ「カ」に誤読されやすい
  gripL:  ['握力左', '左握力', '握カ左'],
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

// ==== 空間フォールバック(トークン座標から記入枠を拾う) =========================
/* フォームパーサの label:value ペアリングは、罫線で仕切られたヘッダー(ID・氏名)では
   よく効く一方、測定行は「ラベル … ①②下書き … 前回値 … 1マス1桁の記入枠 … 単位」と
   要素が横に離れているため、値が「初回」等と誤ペアリングされて数値が空になりやすい。
   ペアリングで数値が取れなかった項目は、OCR トークンの座標から
   「ラベルと同じ行の帯で最も右にある数字クラスタ＝記入枠」を拾って補完する。 */

// 記入枠の構成(整数桁, 小数桁)。SheetMaker.jsx の SHEET_BOXES と一致させること。
const BOX_DIGITS = { height: [3, 1], weight: [3, 1], gripR: [2, 1], gripL: [2, 1], walk5: [1, 1], walk5max: [1, 1], tug: [2, 1], balR: [2, 1], balL: [2, 1] }
// フォールバック値の信頼度上限。要確認しきい値(既定 80)未満に抑え、必ず職員の確認を通す。
const FALLBACK_MAX_CONF = 75

function polyBox(poly) {
  const vs = (poly && (poly.normalizedVertices || poly.vertices)) || []
  if (!vs.length) return null
  const xs = vs.map(v => v.x || 0), ys = vs.map(v => v.y || 0)
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length, left: Math.min(...xs) }
}

// pages[].tokens / lines を { text, x(中心), y(中心), left, conf } に平坦化
function collectPositioned(document, kind) {
  const out = []
  for (const page of (document.pages || [])) {
    for (const it of (page[kind] || [])) {
      const layout = it.layout || {}
      const text = anchorText(document, layout.textAnchor)
      const b = polyBox(layout.boundingPoly)
      if (!text || !b) continue
      out.push({ text, x: b.x, y: b.y, left: b.left, conf: typeof layout.confidence === 'number' ? layout.confidence : null })
    }
  }
  return out
}

function median(arr) {
  if (!arr.length) return 0
  const s = arr.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/* 測定値の妥当範囲。1 マス 1 桁の記入枠は先頭が空欄になることがあり(例: 体重「□50.4」)、
   印字の小数点が読めないと "504" が「50.4(先頭の枠が空欄)」と「504(小数枠が空欄)」の
   どちらにも解釈できる。物理的にあり得る方を採用して取り違えを防ぐ。 */
const VALUE_RANGE = {
  height: [100, 210], weight: [25, 160], gripR: [3, 80], gripL: [3, 80],
  walk5: [1, 30], walk5max: [0.8, 30], tug: [3, 90], balR: [0, 61], balL: [0, 61],
}

// 数字クラスタの連結文字列 → 数値。小数点が読めていなければ枠構成と妥当範囲から位置を補う。
function digitsToValue(joined, boxDef, cid) {
  if (!joined) return null
  if (joined.includes('.')) {
    const v = parseFloat(joined)
    return Number.isFinite(v) ? v : null
  }
  if (!boxDef) return null
  const [ints, fracs] = boxDef
  if (joined.length > ints + fracs) return null
  // ① 末尾 fracs 桁を小数部とみなす(整数側の先頭枠が空欄のケース)
  const split = joined.length > fracs
    ? parseFloat(joined.slice(0, joined.length - fracs) + '.' + joined.slice(joined.length - fracs))
    : NaN
  // ② 整数のみ(小数枠が空欄のケース)
  const intOnly = joined.length <= ints ? parseFloat(joined) : NaN
  // 既定: 枠がすべて埋まっていれば小数点を差し込み、そうでなければ整数とみなす
  let value = joined.length === ints + fracs ? split : intOnly
  // 妥当範囲が分かる項目では、範囲に収まる解釈を優先する(体重「□50.4」→ 504 の取り違えを防ぐ)
  const range = VALUE_RANGE[cid]
  if (range) {
    const ok = (v) => Number.isFinite(v) && v >= range[0] && v <= range[1]
    if (!ok(value)) { if (ok(split)) value = split; else if (ok(intOnly)) value = intOnly }
  }
  return Number.isFinite(value) ? value : null
}

// value が null のままの項目を座標ベースで補完し、補完した cid の一覧を返す(fields を書き換える)
function spatialFallback(document, fields) {
  const lines = collectPositioned(document, 'lines')
  let tokens = collectPositioned(document, 'tokens')
  if (!tokens.length) tokens = lines
  if (!lines.length) return []

  // 測定項目ラベルの行アンカー(同一 cid に複数掛かれば最も左のものを採用)
  const anchors = {}
  for (const ln of lines) {
    const cid = matchFieldId(ln.text)
    if (cid && (!anchors[cid] || ln.left < anchors[cid].left)) anchors[cid] = ln
  }
  const anchorList = Object.keys(anchors).map(cid => ({ cid, ...anchors[cid] })).sort((a, b) => a.y - b.y)
  if (!anchorList.length) return []

  // 行ピッチ(隣接ラベルの y 間隔の中央値)。帯の許容幅に使う。
  const pitch = median(anchorList.slice(1).map((a, i) => a.y - anchorList[i].y)) || 0.05

  // 写真の傾き推定: ラベル(左端)と単位 cm/kg/秒(右端)を y 順に突き合わせ、右端での y ずれを取る
  const unitToks = tokens.filter(t => ['cm', 'kg', '秒'].includes(norm(t.text))).sort((a, b) => a.y - b.y)
  let skewDy = 0, unitX = null
  if (unitToks.length === anchorList.length && anchorList.length >= 3) {
    skewDy = median(unitToks.map((u, i) => u.y - anchorList[i].y))
    unitX = median(unitToks.map(u => u.x))
  }

  const numToks = tokens.filter(t => /^[0-9０-９.．。,]+$/.test(t.text.trim()))
  const prevToks = tokens.filter(t => t.text.includes('前回'))
  const filled = []
  for (const a of anchorList) {
    if (fields[a.cid] && fields[a.cid].value !== null) continue
    const band = numToks
      .filter(t => {
        if (t.x <= a.left + 0.02) return false
        // 傾き分は x 位置に比例して補正した上で、ラベル行の帯に入るものだけを対象にする
        const drift = unitX ? skewDy * (t.x - a.left) / Math.max(unitX - a.left, 1e-6) : 0
        return Math.abs(t.y - (a.y + drift)) <= pitch * 0.45
      })
      // 印字の前回値(「前回 24.0」)を誤って拾わないよう、「前回」の直右の数字は除外
      .filter(t => !prevToks.some(p => Math.abs(p.y - t.y) <= pitch * 0.45 && t.x > p.x && t.x - p.x < 0.15))
      .sort((t1, t2) => t1.x - t2.x)
    if (!band.length) continue
    // x の間隔でクラスタリングし、最も右のクラスタ(=記入枠。下書きや前回値より右にある)を採用
    const clusters = [[band[0]]]
    for (let i = 1; i < band.length; i++) {
      if (band[i].x - band[i - 1].x > 0.06) clusters.push([])
      clusters[clusters.length - 1].push(band[i])
    }
    const box = clusters[clusters.length - 1]
    const joined = zenToHan(box.map(t => t.text).join('')).replace(/[^0-9.]/g, '')
    const value = digitsToValue(joined, BOX_DIGITS[a.cid], a.cid)
    if (value === null) continue
    const confs = box.map(t => t.conf).filter(c => c !== null)
    const conf = Math.min(FALLBACK_MAX_CONF, confs.length ? pct(confs.reduce((s, c) => s + c, 0) / confs.length) : 60)
    fields[a.cid] = { value, raw: joined, conf }
    filled.push(a.cid)
  }
  return filled
}

// document → { ocrName, ocrKana, ocrId, nameConf, fields:{cid:{value,raw,conf}}, debug }
function mapDocumentToSheet(document) {
  const fields = {}
  SHEET_COLS.forEach(cid => { fields[cid] = { value: null, raw: '', conf: 0 } })
  let ocrName = '', ocrKana = '', ocrId = '', nameConf = 0

  const pairs = collectPairs(document)
  for (const { label, value, conf } of pairs) {
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
  // 飛び込み用紙(様式 R7-02W=記録用紙 / R7-03W=問診票)の判定:
  // 用紙に刷った様式番号の文字で機械判別する
  // (norm は空白・ハイフンを除去し小文字化するため R7-02W → r702w)
  const nt = norm(document.text || '')
  const walkIn = nt.includes('r702w') || nt.includes('r703w')
  // ペアリングで数値が取れなかった項目を座標ベースで補完する
  const fallback = spatialFallback(document, fields)
  // 読み取り失敗時の原因調査用(取り込みキューの ocrDebug に保存される)
  const debug = {
    fallback,
    pairs: pairs.slice(0, 40).map(p => ({ label: String(p.label).slice(0, 40), value: String(p.value).slice(0, 40), conf: p.conf })),
  }
  return { ocrName, ocrKana, ocrId, nameConf, fields, walkIn, debug }
}

module.exports = {
  SHEET_COLS, FIELD_ALIASES,
  mapDocumentToSheet, collectPairs, parseNumber, matchFieldId, anchorText, norm, zenToHan,
  spatialFallback, digitsToValue,
}
