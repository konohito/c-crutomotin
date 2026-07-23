'use strict'
/* ローカルエミュレータ / CI 用の合成 Document AI レスポンス。
   実 GCP 資格情報なしで OCR 取り込みパイプラインを通しで検証・デモするための擬似認識結果。
   入力(gcsUri など)から決定論的に生成するため、同じ用紙は毎回同じ値になる。
   実運用(FUNCTIONS_EMULATOR 未設定 かつ DOCAI_PROCESSOR_ID 設定あり)では呼ばれない。 */

// 決定論的 RNG(seed → 0..1)
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6D2B79F5) >>> 0
    return (s >>> 8) / 0xFFFFFF
  }
}
function hashStr(input) {
  const s = String(input == null ? 'mock' : input)
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

const NAMES = [
  ['佐藤 花子', 'サトウ ハナコ'], ['鈴木 一郎', 'スズキ イチロウ'], ['田中 光男', 'タナカ ミツオ'],
  ['山本 幸子', 'ヤマモト サチコ'], ['清水 正', 'シミズ タダシ'], ['高橋 節子', 'タカハシ セツコ'],
]

// 合成 document(カスタム抽出プロセッサ形式: entities[].type / mentionText / confidence)を返す。
// mapDocumentToSheet がそのまま解釈できる形。1 項目だけ低信頼度にして要確認フローも再現する。
function mockDocument(seedInput) {
  const r = rng(hashStr(seedInput))
  const num = (lo, hi, dec = 1) => {
    const p = Math.pow(10, dec)
    return Math.round((lo + (hi - lo) * r()) * p) / p
  }
  const [name, kana] = NAMES[Math.floor(r() * NAMES.length)]
  const id = String(10000 + Math.floor(r() * 400))
  // 握力右 / 握力左 / 5m通常歩行 のうち 1 つを低信頼度(45%)にする
  const lowIdx = Math.floor(r() * 3)
  const conf = (slot) => (slot === lowIdx ? 0.45 : 0.9 + r() * 0.09)
  const rows = [
    ['身長', num(150, 170), conf(-1)],
    ['体重', num(45, 70), conf(-1)],
    ['握力右', num(18, 34), conf(0)],
    ['握力左', num(18, 34), conf(1)],
    ['5m通常歩行', num(0.6, 1.4), conf(2)],
    ['5m最大歩行', num(0.5, 1.2), conf(-1)],
    ['TUG', num(6, 14), conf(-1)],
    ['開眼片足立ち右', num(5, 45), conf(-1)],
    ['開眼片足立ち左', num(5, 45), conf(-1)],
  ]
  const entities = [
    { type: '氏名', mentionText: name, confidence: 0.95 },
    { type: 'ふりがな', mentionText: kana, confidence: 0.9 },
    { type: '参加者ID', mentionText: id, confidence: 0.97 },
    ...rows.map(([label, v, c]) => ({ type: label, mentionText: String(v), confidence: Math.round(c * 100) / 100 })),
  ]
  return { text: '', entities }
}

module.exports = { mockDocument }
