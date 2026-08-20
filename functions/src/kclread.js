'use strict'
/* 基本チェックリスト問診票(様式 R7-03 / R7-03W)のマークシート読み取り。
   OCR トークンを幾何アンカーにして、写真画素の濃度で塗りつぶしを判定する:
   1. 列見出し「はい」「いいえ」トークンで回答 2 列の x 位置と写真の傾きを得る
   2. 各設問の行(印字テキスト)を照合して行の y 位置を得る
   3. 各行 × 各列の楕円位置の画素を窓平均し、行間の紙面(基準)より十分暗ければ塗りと判定
   採点(判定基準)はフロントの kihon.js が担う(公式基準: 1-20 で 10 項目以上 等)。 */
const { anchorText, norm } = require('./mapping')
const { exifOrientation, orientMap } = require('./exif')
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

/* 回答欄の列見出し「はい」「いいえ」を探す。
   用紙には説明文「あてはまる方（はい・いいえ）を…」があり、そこも同じ語のトークンになる。
   説明文は本文カラム(左寄り)、列見出しは回答欄の真上(右端)にあるため、
   条件を満たす組のうち「最も右」を採用する(同じ x に複数あれば最上段)。 */
function findHead(tokens) {
  const cands = []
  const yes = tokens.filter(t => norm(t.text) === 'はい')
  const no = tokens.filter(t => norm(t.text) === 'いいえ')
  for (const a of yes) {
    for (const b of no) {
      if (Math.abs(a.y - b.y) < 0.012 && b.x - a.x > 0.02 && b.x - a.x < 0.25) cands.push({ a, b })
    }
  }
  if (!cands.length) return null
  const maxX = Math.max(...cands.map(c => c.a.x))
  const right = cands.filter(c => c.a.x > maxX - 0.05)
  return right.reduce((m, c) => (!m || c.a.y < m.a.y ? c : m), null)
}

/* 設問行のアンカー(左端 x・中心 x・中心 y)を求める。
   設問文が 2 行に折り返す場合、行(lines)は上下 2 本に分かれるのに対し
   回答欄の楕円は 2 行の中央に置かれるため、行の中心を使うと窓が楕円から外れる。
   折り返しをまとめた段落(paragraphs)が取れていればその中心を使う。
   中心 y は「中心 x の位置での y」なので、傾き補正の基準点も中心 x にする。 */
function rowAnchor(ln, paras, np) {
  const h = Math.max(1e-6, ln.bottom - ln.top)
  const p = paras.find(p2 => norm(p2.text).includes(np)
    && p2.top <= ln.top + h * 0.5 && p2.bottom >= ln.bottom - h * 0.5
    && (p2.bottom - p2.top) <= h * 3.2)
  const el = p || ln
  return { x: ln.left, cx: (el.left + el.right) / 2, y: (el.top + el.bottom) / 2 }
}

/* 用紙の傾き(dx/dy)を設問行の左端から頑健に推定する。
   手持ち撮影ではわずかに回転するため、下の行ほど回答欄の x 位置も横にずれる。
   行の左端は「①」を含むかどうかで揺れることがあるので、
   全ペアの傾きの中央値(Theil–Sen)を採って外れ値の影響を抑える。 */
function estimateTilt(rows) {
  if (rows.length < 4) return null
  const sl = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const dy = rows[j].y - rows[i].y
      if (Math.abs(dy) < 0.02) continue
      sl.push((rows[j].x - rows[i].x) / dy)
    }
  }
  if (sl.length < 6) return null
  sl.sort((a, b) => a - b)
  const t = sl[Math.floor(sl.length / 2)]
  return Math.abs(t) <= 0.15 ? t : null   // 約 8 度を超える推定は誤りとみなして使わない
}

// document(OCR) + 画像バイト列 → { isKcl, side, answers:{key:'yes'|'no'|'multi'|null}, readable }
function readKcl(document, imageBuffer, mimeType) {
  const nt = norm(document.text || '')
  const isKcl = nt.includes('r703') || nt.includes('基本チェックリスト')
  if (!isKcl) return { isKcl: false }
  const lines = positioned(document, 'lines')
  const paras = positioned(document, 'paragraphs')
  const tokens = positioned(document, 'tokens')

  const head = findHead(tokens)
  // 設問行の照合(行テキストに設問プレフィックスが含まれるか)
  const rows = []
  for (const [key, prefix] of QS) {
    const np = norm(prefix)
    const ln = lines.find(l => norm(l.text).includes(np))
    if (ln) rows.push({ key, ...rowAnchor(ln, paras, np) })
  }
  const side = rows.some(r => typeof r.key === 'number' && r.key <= 11) ? 'front' : (rows.length ? 'back' : null)
  const unreadable = (reason) => ({ isKcl: true, side, answers: {}, readable: false, reason })
  if (!head) return unreadable('列見出し「はい」「いいえ」を検出できませんでした')
  if (!rows.length) return unreadable('設問行を検出できませんでした')

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

  const mean = (cx, cy, w, h) => {
    let s = 0, n = 0
    const x0 = Math.max(0, Math.round((cx - w / 2) * W)), x1 = Math.min(W - 1, Math.round((cx + w / 2) * W))
    const y0 = Math.max(0, Math.round((cy - h / 2) * H)), y1 = Math.min(H - 1, Math.round((cy + h / 2) * H))
    const st = Math.max(1, Math.round((x1 - x0) / 12) || 1)
    for (let py = y0; py <= y1; py += st) {
      for (let px = x0; px <= x1; px += st) {
        const [rx, ry] = om.at(px, py)
        const i = ((ry * rw) + rx) * 4
        s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++
      }
    }
    return n ? s / n : 255
  }

  const dx = head.b.x - head.a.x                 // 列間(設計 74px 相当)→ 写真上のスケール基準
  const tilt = estimateTilt(rows)                // 用紙の回転(下の行ほど列の x がずれる。dx/dy)
  /* 正規化座標は x が幅・y が高さで割られているため縦横で尺度が違う。
     回転量を x↔y に読み換えるときは (W/H)^2 を掛けて尺度を合わせる。
     行アンカーから推定した傾きの方が、見出し 2 語(74px)から測るより誤差が小さい。 */
  const ar = W / H
  const slope = tilt !== null ? -tilt * ar * ar : (head.b.y - head.a.y) / dx  // x に比例した y ずれ
  const bw = dx * (15 / 74) * 0.75               // 楕円内側の窓(x 方向・正規化。用紙の楕円 15×21px に一致)
  const bh = dx * (21 / 74) * 0.75 * (W / H)     // 同(y 方向は画像アスペクトで換算)
  /* 幾何の残差(遠近ゆがみ・行の検出誤差)を吸収するため、期待位置の周囲を少し探して
     最も暗い窓を採る。x は隣の列が 74px 先なので広め(楕円 0.4 個分)に探せるが、
     y は上下の行が 34px 間隔で「記入例」の見本も近いため、狭く(0.12 個分)に留める。 */
  const darkest = (cx, cy) => {
    let best = 255
    for (const ox of [-0.4, -0.2, 0, 0.2, 0.4]) {
      for (const oy of [-0.12, 0, 0.12]) {
        const v = mean(cx + ox * bw * 1.33, cy + oy * bh * 1.33, bw, bh)
        if (v < best) best = v
      }
    }
    return best
  }
  const answers = {}
  for (const r of rows) {
    const shift = tilt !== null ? tilt * (r.y - head.a.y) : 0   // 回転による列 x のずれ
    const ax = head.a.x + shift, bx = head.b.x + shift
    const yAt = (colX) => r.y + slope * (colX - r.cx)
    const midX = (ax + bx) / 2
    const paper = mean(midX, yAt(midX), bw, bh)  // 2 列の間の紙面を基準の白とする
    const dY = paper - darkest(ax, yAt(ax))
    const dN = paper - darkest(bx, yAt(bx))
    const strong = (d) => d > 25 && d > paper * 0.28
    let fy = strong(dY), fn = strong(dN)
    // どちらも基準未満でも、片側だけが明らかに暗ければ薄い塗りとして採用する
    // (かすれ・鉛筆・コピー濃度が薄い用紙の救済。裏写りは両側同程度に出るため誤検出しにくい)
    if (!fy && !fn) {
      if (dY > 12 && dY > dN * 2.2) fy = true
      else if (dN > 12 && dN > dY * 2.2) fn = true
    }
    answers[r.key] = fy && fn ? 'multi' : fy ? 'yes' : fn ? 'no' : null
  }
  return { isKcl: true, side, answers, readable: true, orient }
}

module.exports = { readKcl, QS }
