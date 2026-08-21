'use strict'
/* 写真の中から用紙と四隅の位置合わせマーカーを見つけ、
   用紙座標(版面比 0〜1)→ 写真画素 の射影変換(ホモグラフィ)を求める。

   OCR の文字位置から回答欄を推定する方法は、手持ち撮影の遠近のゆがみ(台形)に弱い。
   用紙には読み取り用の四隅マーカーが印刷してあるので、それを基準にすれば
   回転・台形のゆがみを含めて用紙座標に正確に引き直せる。 */

// 画素アクセスを面倒なく行うための小さなラッパ(表示向きの座標で読める)
function makeSampler(img, om) {
  const rw = img.width, data = img.data
  return {
    W: om.W, H: om.H,
    lum(x, y) {
      const [rx, ry] = om.at(x, y)
      const i = ((ry * rw) + rx) * 4
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    },
  }
}

// 縮小したグレースケール(検出は粗い解像度で十分。写真が大きくても速い)
function downscale(sampler, targetW) {
  const step = Math.max(1, Math.floor(sampler.W / targetW))
  const w = Math.floor(sampler.W / step), h = Math.floor(sampler.H / step)
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g[y * w + x] = sampler.lum(x * step, y * step)
  }
  return { g, w, h, step }
}

// 連結成分のラベリング(4 近傍)。ok(値) が真の画素をひとかたまりにする
function components(g, w, h, ok, minPx) {
  const seen = new Uint8Array(w * h)
  const out = []
  const stack = []
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !ok(g[i])) continue
    let n = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0
    stack.push(i); seen[i] = 1
    while (stack.length) {
      const p = stack.pop()
      const px = p % w, py = (p - px) / w
      n++; sx += px; sy += py
      if (px < x0) x0 = px; if (px > x1) x1 = px
      if (py < y0) y0 = py; if (py > y1) y1 = py
      if (px > 0 && !seen[p - 1] && ok(g[p - 1])) { seen[p - 1] = 1; stack.push(p - 1) }
      if (px < w - 1 && !seen[p + 1] && ok(g[p + 1])) { seen[p + 1] = 1; stack.push(p + 1) }
      if (py > 0 && !seen[p - w] && ok(g[p - w])) { seen[p - w] = 1; stack.push(p - w) }
      if (py < h - 1 && !seen[p + w] && ok(g[p + w])) { seen[p + w] = 1; stack.push(p + w) }
    }
    if (n >= minPx) out.push({ n, cx: sx / n, cy: sy / n, x0, x1, y0, y1 })
  }
  return out
}

// 用紙(明るい大きなかたまり)の範囲を求める
function findPaper(sm) {
  const { g, w, h, step } = sm
  const sorted = Float32Array.from(g).sort()
  const hi = sorted[Math.floor(sorted.length * 0.9)]
  const lo = sorted[Math.floor(sorted.length * 0.1)]
  if (hi - lo < 25) return null                       // 明暗の差が無い(用紙が見つからない)
  const thr = lo + (hi - lo) * 0.55
  const cc = components(g, w, h, (v) => v >= thr, Math.floor(w * h * 0.05))
  if (!cc.length) return null
  const big = cc.reduce((a, b) => (b.n > a.n ? b : a))
  if (big.n < w * h * 0.12) return null               // 小さすぎる = 用紙ではない
  return { ...big, step }
}

/* 用紙の四隅にある黒いマーカーの中心を探す。
   用紙の各隅から 30% の範囲を見て、その中で「小さくてほぼ正方形の暗いかたまり」のうち
   最も隅に近いものを採る(ID 欄の枠線や文字を拾わないよう大きさと形で絞る)。 */
function findMarkers(sm, paper) {
  const { g, w, h } = sm
  const pw = paper.x1 - paper.x0, ph = paper.y1 - paper.y0
  if (pw < 40 || ph < 40) return null
  // 用紙内の明暗からマーカー用のしきい値を決める
  let sum = 0, n = 0
  for (let y = paper.y0; y <= paper.y1; y++) {
    for (let x = paper.x0; x <= paper.x1; x++) { sum += g[y * w + x]; n++ }
  }
  const mean = n ? sum / n : 200
  const thr = mean * 0.55
  const expect = (pw / 794) * 17            // マーカーの一辺(用紙 794px 中 17px)
  const minPx = Math.max(4, Math.round(expect * expect * 0.25))
  const cc = components(g, w, h, (v) => v <= thr, minPx)
  const cand = cc.filter(c => {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1
    if (cw < expect * 0.4 || cw > expect * 3) return false
    if (ch < expect * 0.4 || ch > expect * 3) return false
    if (cw / ch < 0.5 || cw / ch > 2) return false     // ほぼ正方形(丸も含む)
    return c.cx >= paper.x0 && c.cx <= paper.x1 && c.cy >= paper.y0 && c.cy <= paper.y1
  })
  if (cand.length < 4) return null
  const corners = {
    tl: [paper.x0, paper.y0], tr: [paper.x1, paper.y0],
    bl: [paper.x0, paper.y1], br: [paper.x1, paper.y1],
  }
  const out = {}
  const used = new Set()
  for (const k of ['tl', 'tr', 'bl', 'br']) {
    const [ax, ay] = corners[k]
    let best = null, bestD = Infinity
    for (const c of cand) {
      if (used.has(c)) continue
      const d = Math.hypot(c.cx - ax, c.cy - ay)
      if (d > Math.hypot(pw, ph) * 0.3) continue       // 隅から遠すぎる
      if (d < bestD) { bestD = d; best = c }
    }
    if (!best) return null
    used.add(best)
    out[k] = [best.cx * paper.step, best.cy * paper.step]
  }
  return out
}

// 4 点が(順に並んだ)凸四角形か
function isConvex(p) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4]
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (!cr) continue
    const sg = cr > 0 ? 1 : -1
    if (!sign) sign = sg
    else if (sg !== sign) return false
  }
  return !!sign
}

// 4 点対応から射影変換(3x3)を解く。src=用紙座標(0〜1)、dst=写真画素
function solveHomography(src, dst) {
  const A = [], b = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v)
  }
  // ガウスの消去法(8 元)
  const M = A.map((row, i) => row.concat([b[i]]))
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    const t = M[c]; M[c] = M[p]; M[p] = t
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= 8; k++) M[r][k] -= f * M[c][k]
    }
  }
  const hv = M.map((row, i) => row[8] / row[i])
  return [[hv[0], hv[1], hv[2]], [hv[3], hv[4], hv[5]], [hv[6], hv[7], 1]]
}

/* 写真 → 用紙座標の対応付けを求める。
   戻り値 { at(x, y) -> [写真px, 写真py] }（x, y は版面比 0〜1）。見つからなければ null。 */
function paperMapping(img, om, layout) {
  const sampler = makeSampler(img, om)
  const sm = downscale(sampler, 700)
  const paper = findPaper(sm)
  if (!paper) return null
  const mk = findMarkers(sm, paper)
  if (!mk) return null
  // 検出した 4 点が用紙の形になっているかを確かめる(塗りの有無に依存しない検算)。
  // 縦横比が版面と大きく違う・凸四角形でない場合は、別のものを拾っている。
  const wTop = Math.hypot(mk.tr[0] - mk.tl[0], mk.tr[1] - mk.tl[1])
  const wBot = Math.hypot(mk.br[0] - mk.bl[0], mk.br[1] - mk.bl[1])
  const hL = Math.hypot(mk.bl[0] - mk.tl[0], mk.bl[1] - mk.tl[1])
  const hR = Math.hypot(mk.br[0] - mk.tr[0], mk.br[1] - mk.tr[1])
  if (!wTop || !wBot || !hL || !hR) return null
  // 比率座標(x は幅・y は高さで割ってある)から実寸の比に直してから比べる
  const expect = ((layout.markers.tr[0] - layout.markers.tl[0]) * layout.aspect)
    / (layout.markers.bl[1] - layout.markers.tl[1])
  const got = ((wTop + wBot) / 2) / ((hL + hR) / 2)
  if (got < expect * 0.65 || got > expect * 1.55) return null    // 縦横比が合わない
  if (Math.max(wTop, wBot) / Math.min(wTop, wBot) > 1.7) return null   // 台形が極端すぎる
  if (Math.max(hL, hR) / Math.min(hL, hR) > 1.7) return null
  if (!isConvex([mk.tl, mk.tr, mk.br, mk.bl])) return null

  const order = ['tl', 'tr', 'br', 'bl']
  const H = solveHomography(order.map(k => layout.markers[k]), order.map(k => mk[k]))
  if (!H) return null
  return {
    markers: mk,
    at(x, y) {
      const w = H[2][0] * x + H[2][1] * y + 1
      return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]
    },
  }
}

module.exports = { makeSampler, paperMapping, solveHomography }
