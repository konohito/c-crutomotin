'use strict'
/* 基本チェックリスト問診票(様式 R7-03 / R7-03W)のマークシート読み取り。
   OCR トークンを幾何アンカーにして、写真画素の濃度で塗りつぶしを判定する:
   1. 列見出し「はい」「いいえ」トークンで回答 2 列の x 位置と写真の傾きを得る
   2. 各設問の行(印字テキスト)を照合して行の y 位置を得る
   3. 各行 × 各列の楕円位置の画素を窓平均し、行間の紙面(基準)より十分暗ければ塗りと判定
   採点(判定基準)はフロントの kihon.js が担う(公式基準: 1-20 で 10 項目以上 等)。 */
const { anchorText, norm } = require('./mapping')
const jpeg = require('jpeg-js')

// 印刷順の設問プレフィックス。key は公式 No(12=BMI は用紙に無い) / ex1・ex2(運動習慣)
const QS = [
  [1, 'バスや電車で1人で外出'], [2, '日用品の買い物'], [3, '預貯金の出し入れ'], [4, '友人の家を訪ねて'], [5, '家族や友人の相談'],
  [6, '階段を手すりや壁をつたわらず'], [7, '椅子に座った状態から何もつかまらず'], [8, '15分位続けて歩いて'], [9, 'この1年間に転んだ'], [10, '転倒に対する不安'],
  [11, '6ヶ月間で2'], [13, '半年前に比べて固いもの'], [14, 'お茶や汁物等でむせる'], [15, '口の渇きが気になり'], [16, '週に1回以上は外出'],
  [17, '昨年と比べて外出の回数'], [18, '周りの人から'], [19, '自分で電話番号を調べて'], [20, '今日が何月何日かわからない'],
  [21, '毎日の生活に充実感がない'], [22, 'これまで楽しんでやれていた'], [23, '以前は楽にできていたこと'], [24, '自分が役に立つ人間だと思えない'], [25, 'わけもなく疲れたような感じ'],
  ['ex1', '週1回程度の定期的な運動'], ['ex2', 'ストレッチや筋トレなどの運動を週1回'],
]

function positioned(document, kind) {
  const out = []
  for (const page of (document.pages || [])) {
    for (const it of (page[kind] || [])) {
      const layout = it.layout || {}
      const text = anchorText(document, layout.textAnchor)
      const vs = (layout.boundingPoly && (layout.boundingPoly.normalizedVertices || layout.boundingPoly.vertices)) || []
      if (!text || !vs.length) continue
      const xs = vs.map(v => v.x || 0), ys = vs.map(v => v.y || 0)
      out.push({ text, x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length, left: Math.min(...xs) })
    }
  }
  return out
}

// document(OCR) + 画像バイト列 → { isKcl, side, answers:{key:'yes'|'no'|'multi'|null}, readable }
function readKcl(document, imageBuffer, mimeType) {
  const nt = norm(document.text || '')
  const isKcl = nt.includes('r703') || nt.includes('基本チェックリスト')
  if (!isKcl) return { isKcl: false }
  const lines = positioned(document, 'lines')
  const tokens = positioned(document, 'tokens')

  // 列見出し: 単独の「はい」「いいえ」トークンが横に隣接するペアのうち最上段を採用
  let head = null
  for (const a of tokens.filter(t => norm(t.text) === 'はい')) {
    for (const b of tokens.filter(t => norm(t.text) === 'いいえ')) {
      if (Math.abs(a.y - b.y) < 0.012 && b.x - a.x > 0.02 && b.x - a.x < 0.25) {
        if (!head || a.y < head.a.y) head = { a, b }
      }
    }
  }
  // 設問行の照合(行テキストに設問プレフィックスが含まれるか)
  const rows = []
  for (const [key, prefix] of QS) {
    const np = norm(prefix)
    const ln = lines.find(l => norm(l.text).includes(np))
    if (ln) rows.push({ key, x: ln.left, y: ln.y })
  }
  const side = rows.some(r => typeof r.key === 'number' && r.key <= 11) ? 'front' : (rows.length ? 'back' : null)
  if (!head || !rows.length) return { isKcl: true, side, answers: {}, readable: false }

  // 画像復号(JPEG のみ。失敗時は要確認のまま返す)
  let img = null
  try {
    if (imageBuffer && (!mimeType || /jpe?g/i.test(String(mimeType)))) {
      img = jpeg.decode(imageBuffer, { maxMemoryUsageInMB: 400, formatAsRGBA: true })
    }
  } catch { img = null }
  if (!img) return { isKcl: true, side, answers: {}, readable: false }

  const W = img.width, H = img.height, data = img.data
  const mean = (cx, cy, w, h) => {
    let s = 0, n = 0
    const x0 = Math.max(0, Math.round((cx - w / 2) * W)), x1 = Math.min(W - 1, Math.round((cx + w / 2) * W))
    const y0 = Math.max(0, Math.round((cy - h / 2) * H)), y1 = Math.min(H - 1, Math.round((cy + h / 2) * H))
    const st = Math.max(1, Math.round((x1 - x0) / 12) || 1)
    for (let py = y0; py <= y1; py += st) {
      for (let px = x0; px <= x1; px += st) {
        const i = ((py * W) + px) * 4
        s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++
      }
    }
    return n ? s / n : 255
  }

  const dx = head.b.x - head.a.x                 // 列間(設計 74px 相当)→ 写真上のスケール基準
  const slope = (head.b.y - head.a.y) / dx       // 写真の傾き(x に比例した y ずれ)
  const bw = dx * (15 / 74) * 0.75               // 楕円内側の窓(x 方向・正規化。用紙の楕円 15×21px に一致)
  const bh = dx * (21 / 74) * 0.75 * (W / H)     // 同(y 方向は画像アスペクトで換算)
  const answers = {}
  for (const r of rows) {
    const yAt = (colX) => r.y + slope * (colX - r.x)
    const midX = (head.a.x + head.b.x) / 2
    const paper = mean(midX, yAt(midX), bw, bh)  // 2 列の間の紙面を基準の白とする
    const ly = mean(head.a.x, yAt(head.a.x), bw, bh)
    const ln = mean(head.b.x, yAt(head.b.x), bw, bh)
    const fy = ly < paper * 0.72 && paper - ly > 25
    const fn = ln < paper * 0.72 && paper - ln > 25
    answers[r.key] = fy && fn ? 'multi' : fy ? 'yes' : fn ? 'no' : null
  }
  return { isKcl: true, side, answers, readable: true }
}

module.exports = { readKcl, QS }
