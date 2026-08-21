'use strict'
/* 基本チェックリスト問診票(様式 R7-03 / R7-03W)のマークシート読み取り。
   1. OCR の文字から、この写真がどちらの面(おもて/うら)かを判断する
   2. 写真から用紙と四隅の位置合わせマーカーを見つけ、用紙座標に引き直す(sheetgeom)
   3. 実測した回答欄の座標(kcllayout)を写真上の位置に変換し、塗りつぶしの濃さで判定する
   採点(判定基準)はフロントの kihon.js が担う(公式基準: 1-20 で 10 項目以上 等)。

   文字の位置から回答欄を推定する方法は手持ち撮影の遠近のゆがみに弱く、
   下の設問ほどずれて「はい・いいえ」が入れ替わることがあったため、
   マーカー基準に一本化している(検出できなければ読み取り不可として撮り直しを促す)。 */
const { anchorText, norm } = require('./mapping')
const { exifOrientation, orientMap } = require('./exif')
const { paperMapping } = require('./sheetgeom')
const LAYOUT = require('./kcllayout')
const jpeg = require('jpeg-js')

// 印刷順の設問プレフィックス。key は公式 No(12=BMI は用紙に無い) / ex1・ex2(運動習慣)
const QS = [
  [1, 'バスや電車で1人で外出'], [2, '日用品の買い物'], [3, '預貯金の出し入れ'], [4, '友人の家を訪ねて'], [5, '家族や友人の相談'],
  [6, '階段を手すりや壁をつたわらず'], [7, '椅子に座った状態から何もつかまらず'], [8, '15分位続けて歩いて'], [9, 'この1年間に転んだ'], [10, '転倒に対する不安'],
  [11, '6ヶ月間で2'], [13, '半年前に比べて固いもの'], [14, 'お茶や汁物等でむせる'], [15, '口の渇きが気になり'], [16, '週に1回以上は外出'],
  [17, '昨年と比べて外出の回数'], [18, '周りの人から'], [19, '自分で電話番号を調べて'], [20, '今日が何月何日かわからない'],
  [21, '毎日の生活に充実感がない'], [22, 'これまで楽しんでやれていた'], [23, '以前は楽にできていたこと'], [24, '自分が役に立つ人間だと思えない'], [25, 'わけもなく疲れたような感じ'],
  ['ex1', '週1回程度の定期的な運動'], ['ex2', 'ストレッチや筋トレ'],
]
/* プレフィックスは「印刷時に 1 行の中に収まる範囲」で切ること。
   用紙は幅で折り返すため、行をまたぐ長さにすると どの行にも含まれず設問が見つからない。
   例: ex2 は「…ストレッチや筋トレなどの運動を / 週1回以上は…」で折り返すため、
   以前の '…運動を週1回' では一致せず、運動習慣②が常に読み取れなかった。 */

function positioned(document, kind) {
  const out = []
  for (const page of (document.pages || [])) {
    for (const it of (page[kind] || [])) {
      const layout = it.layout || {}
      const text = anchorText(document, layout.textAnchor)
      const vs = (layout.boundingPoly && (layout.boundingPoly.normalizedVertices || layout.boundingPoly.vertices)) || []
      if (!text || !vs.length) continue
      const xs = vs.map(v => v.x || 0), ys = vs.map(v => v.y || 0)
      out.push({
        text,
        x: xs.reduce((a, b) => a + b, 0) / xs.length,
        y: ys.reduce((a, b) => a + b, 0) / ys.length,
        left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
      })
    }
  }
  return out
}






/* 四隅マーカーを基準にした読み取り。
   用紙の版面比で持っている回答欄の座標(kcllayout)を写真上の位置に変換して濃度を見る。
   ID 欄の作りで設問行が 2% ほど動くため様式が 3 種類ある。どれかは写真から判断できない
   ことがあるので、3 つとも試して「片方の列だけがはっきり暗い」が最も揃うものを採る。 */
function readByMarkers(img, om, side, keys) {
  if (!side) return null
  const map = paperMapping(img, om, LAYOUT)
  if (!map) return null
  const W = om.W, H = om.H, rw = img.width, data = img.data
  // 楕円の内側だけを見る窓の大きさ(版面比 → 写真画素の縮尺は上辺のマーカー間から求める)
  const c1 = map.at(LAYOUT.markers.tl[0], LAYOUT.markers.tl[1])
  const c2 = map.at(LAYOUT.markers.tr[0], LAYOUT.markers.tr[1])
  const pxPerUnitX = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) / (LAYOUT.markers.tr[0] - LAYOUT.markers.tl[0])
  const bw = LAYOUT.oval.w * 0.72 * pxPerUnitX
  const bh = LAYOUT.oval.h * 0.72 * pxPerUnitX * (W / H)   // 版面比の y は高さ基準なので換算

  const scan = (px, py, thr) => {
    let s = 0, n = 0, dark = 0
    const x0 = Math.max(0, Math.round(px - bw / 2)), x1 = Math.min(W - 1, Math.round(px + bw / 2))
    const y0 = Math.max(0, Math.round(py - bh / 2)), y1 = Math.min(H - 1, Math.round(py + bh / 2))
    const st = Math.max(1, Math.round((x1 - x0) / 14) || 1)
    for (let y = y0; y <= y1; y += st) {
      for (let x = x0; x <= x1; x += st) {
        const [rx, ry] = om.at(x, y)
        const i = ((ry * rw) + rx) * 4
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        s += lum; n++
        if (lum < thr) dark++
      }
    }
    return { mean: n ? s / n : 255, frac: n ? dark / n : 0 }
  }

  const wanted = keys.map(k => String(k))
  let best = null
  for (const [name, v] of Object.entries(LAYOUT.variants)) {
    const table = v[side]
    if (!table) continue
    const answers = {}
    let score = 0, seen = 0
    for (const key of wanted) {
      const cell = table[key]
      if (!cell) continue
      seen++
      const py = map.at(cell.yes[0], cell.yes[1])
      const pn = map.at(cell.no[0], cell.no[1])
      // 2 列の中間を紙面(基準の白)とする。行ごとに取るので影・照明ムラに強い
      const pm = map.at((cell.yes[0] + cell.no[0]) / 2, (cell.yes[1] + cell.no[1]) / 2)
      const paper = scan(pm[0], pm[1], -1).mean
      const thr = Math.min(paper * 0.62, paper - 28)
      const fY = scan(py[0], py[1], thr).frac
      const fN = scan(pn[0], pn[1], thr).frac
      let fy = fY >= 0.30, fn = fN >= 0.30
      if (!fy && !fn) {
        if (fY >= 0.12 && fY > fN * 3) fy = true
        else if (fN >= 0.12 && fN > fY * 3) fn = true
      }
      answers[key] = fy && fn ? 'multi' : fy ? 'yes' : fn ? 'no' : null
      score += Math.abs(fY - fN)      // 片側だけ塗られていれば大きくなる
    }
    if (!seen) continue
    const avg = score / seen
    if (!best || avg > best.avg) best = { avg, answers, variant: name }
  }
  /* 位置合わせ自体は四隅マーカーで検算済みなので、塗りが 1 つも無い用紙(白紙)でも
     そのまま「すべて未回答」として返す。得点は様式の選択にだけ使う。 */
  return best
}

// document(OCR) + 画像バイト列 → { isKcl, side, answers:{key:'yes'|'no'|'multi'|null}, readable }
function readKcl(document, imageBuffer, mimeType) {
  const nt = norm(document.text || '')
  const isKcl = nt.includes('r703') || nt.includes('基本チェックリスト')
  if (!isKcl) return { isKcl: false }
  const lines = positioned(document, 'lines')
  const tokens = positioned(document, 'tokens')

  // どの設問がこの面にあるか(＝おもて/うら)を把握する。位置の推定には使わない
  const keys = []
  for (const [key, prefix] of QS) {
    const np = norm(prefix)
    if (lines.some(l => norm(l.text).includes(np))) keys.push(key)
  }
  const side = keys.some(k => typeof k === 'number' && k <= 11) ? 'front' : (keys.length ? 'back' : null)
  const unreadable = (reason) => ({ isKcl: true, side, answers: {}, readable: false, reason })
  if (!keys.length) return unreadable('設問の文字を読み取れませんでした（用紙全体がはっきり写るように撮り直してください）')

  // 画像復号(JPEG のみ。失敗時は要確認のまま返す)
  let img = null
  try {
    if (imageBuffer && (!mimeType || /jpe?g/i.test(String(mimeType)))) {
      img = jpeg.decode(imageBuffer, { maxMemoryUsageInMB: 400, formatAsRGBA: true })
    }
  } catch { img = null }
  if (!img) return unreadable(`画像を読み込めませんでした(${mimeType || '不明な形式'}。JPEG で撮影・保存してください)`)

  // スマホ写真は EXIF に「表示時に何度回すか」を持つ。Document AI は回転を補正した
  // 向きで座標を返すため、生画素をそのまま参照すると座標系がずれる。表示向きに引き直す。
  const orient = exifOrientation(imageBuffer)
  const om = orientMap(orient, img.width, img.height)
  const W = om.W, H = om.H, rw = img.width, data = img.data

  // それでも縦横が入れ替わっている場合(EXIF 以外の要因で補正が入った等)は、
  // 誤った値を出さずに要確認へ回す。
  const dim = ((document.pages || [])[0] || {}).dimension
  if (dim && dim.width && dim.height) {
    const rDoc = dim.width / dim.height, rImg = W / H
    if (Math.abs(rDoc - rImg) / rDoc > 0.08 && Math.abs(1 / rDoc - rImg) * rDoc < 0.08) {
      return unreadable('画像の向きが認識結果と一致しませんでした(撮影時の回転情報)')
    }
  }

  /* --- 本命の経路: 四隅マーカーから用紙座標に引き直して回答欄を直接見る ---
     OCR の文字位置から推定する方法は手持ち撮影の遠近のゆがみ(台形)に弱く、
     下の設問ほど判定位置がずれる。用紙には読み取り用のマーカーが印刷してあるので、
     それを基準にすれば回転も台形も含めて正確に合わせられる。 */
  const byMarkers = readByMarkers(img, om, side, keys)
  if (byMarkers) return { isKcl: true, side, answers: byMarkers.answers, readable: true, orient, via: 'markers', variant: byMarkers.variant }

  /* 四隅マーカーが見つからないときは、無理に推定せず要確認へ回す。
     文字位置からの推定は遠近のゆがみで「はい・いいえ」が入れ替わることがあり、
     誤った回答が登録される方が、読めないより危険なため。 */
  return unreadable('用紙の四隅にある黒い位置合わせマーカーを検出できませんでした（用紙全体が入るように、真上から撮り直してください）')
}

module.exports = { readKcl, QS }
